import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TrackingService } from './tracking.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { DeliveryProximityService } from './delivery-proximity.service';

/**
 * VERROU ANTI-PERTE DE DONNÉES GPS (audit 2026-08-28).
 *
 * Ces bugs ont survécu parce qu'aucun test ne couvrait le CONTRAT DE BOUT EN
 * BOUT entre le client (worker natif Android / file IndexedDB du JS) et la
 * réponse du serveur. Le serveur pouvait jeter des positions et répondre 200 :
 * le client marquait alors tout le lot comme synchronisé et détruisait
 * définitivement les positions rejetées.
 *
 * Chaque test ci-dessous fige une garantie : « le serveur DIT toujours ce qu'il
 * a refusé ». Si un futur changement casse cette garantie, ces tests échouent.
 */
describe('Anti-perte de données GPS — contrat de réponse des lots', () => {
  let service: TrackingService;

  const VEHICLE_ID = '11111111-1111-4111-8111-111111111111';
  const USER_ID = 'user-driver-1';
  const COMPANY_ID = 'company-1';

  const mockPrisma = {
    driver: { findUnique: jest.fn() },
    delivery: { findMany: jest.fn() },
    vehicle: { findMany: jest.fn() },
    gpsPosition: { findMany: jest.fn(), createManyAndReturn: jest.fn() },
  };

  const basePosition = (overrides: Record<string, unknown> = {}) => ({
    latitude: -18.8792,
    longitude: 47.5079,
    accuracy: 12,
    speed: 5,
    timestamp: new Date().toISOString(),
    vehicleId: VEHICLE_ID,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'driver-1' });
    mockPrisma.delivery.findMany.mockResolvedValue([]);
    mockPrisma.vehicle.findMany.mockResolvedValue([{ id: VEHICLE_ID }]);
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);
    mockPrisma.gpsPosition.createManyAndReturn.mockImplementation(async ({ data }: any) =>
      data.map((d: any, i: number) => ({ id: `pos-${i}`, ...d })),
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: mockPrisma },
        // Rate limits désactivés : ces tests portent sur le contrat de rejet.
        { provide: ConfigService, useValue: { get: (_k: string, d?: unknown) => d ?? '0' } },
        { provide: CacheService, useValue: { get: jest.fn(), set: jest.fn() } },
        { provide: DataUpdateBus, useValue: { emitUpdate: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        { provide: GeofenceService, useValue: { checkGeofences: jest.fn() } },
        {
          provide: DeliveryProximityService,
          useValue: { checkProximity: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = moduleRef.get(TrackingService);
  });

  it("A1 — une position dont l'accuracy dépasse le plafond est SIGNALÉE, jamais jetée en silence", async () => {
    // Android remonte couramment 1500-3000 m au démarrage à froid / en intérieur.
    const result = await service.validateAndSaveBatch(USER_ID, COMPANY_ID, [
      basePosition(),
      basePosition({ accuracy: 1500 }),
    ]);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Le rejet est explicitement remonté À SON INDEX : le client peut ne
    // marquer « synchronisées » que les positions réellement traitées.
    expect(result.rejected).toEqual([{ index: 1, reason: expect.stringContaining('max') }]);
    expect(result.validatedCount).toBe(1);
  });

  it('A1 (pire cas) — une horloge décalée invalide TOUT le lot : chaque rejet est listé', async () => {
    // Cas reproductible sur un appareil bas de gamme dont l'horloge dérive :
    // AVANT, validatedCount=0 renvoyait un 200 nu et la file native entière
    // était effacée lot par lot, sans une seule erreur visible.
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await service.validateAndSaveBatch(USER_ID, COMPANY_ID, [
      basePosition({ timestamp: farFuture }),
      basePosition({ timestamp: farFuture }),
    ]);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.validatedCount).toBe(0);
    expect(result.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(result.rejected[0].reason).toContain('isPlausibleTimestamp');
  });

  it('A8 — une livraison périmée DÉTACHE la position au lieu de la détruire', async () => {
    const STALE_DELIVERY = '22222222-2222-4222-8222-222222222222';
    // Aucune livraison vérifiée : le deliveryId de la file est obsolète
    // (livraison terminée/réassignée pendant que le téléphone était hors ligne).
    mockPrisma.delivery.findMany.mockResolvedValue([]);

    const result = await service.validateAndSaveBatch(USER_ID, COMPANY_ID, [
      basePosition({ deliveryId: STALE_DELIVERY }),
    ]);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // La trajectoire du VÉHICULE reste une donnée valide (elle alimente le
    // rapport carburant, calculé par véhicule) : elle est persistée, sans
    // association de livraison.
    expect(result.saved).toHaveLength(1);
    const inserted = mockPrisma.gpsPosition.createManyAndReturn.mock.calls[0][0].data;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].deliveryId).toBeUndefined();
    expect(inserted[0].vehicleId).toBe(VEHICLE_ID);
  });

  it('A1 — un lot entièrement valide ne signale AUCUN rejet', async () => {
    const result = await service.validateAndSaveBatch(USER_ID, COMPANY_ID, [
      basePosition(),
      basePosition({ timestamp: new Date(Date.now() - 3000).toISOString() }),
    ]);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.rejected).toEqual([]);
    expect(result.validatedCount).toBe(2);
  });
});
