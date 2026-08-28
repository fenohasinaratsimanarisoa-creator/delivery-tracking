import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FuelConsumptionService } from './fuel-consumption.service';

/**
 * VERROU ANTI-FAUSSE-ACCUSATION (audit GPS/carburant 2026-08-28, C1 et C3).
 *
 * Le cross-check carburant compare le kilométrage SAISI par le chauffeur à la
 * distance GPS. Quand le téléphone n'a pas tracké, la distance GPS est
 * structurellement sous-estimée : sans garde-fou, le système conclut à une
 * « sur-déclaration » et envoie une notification de priorité HAUTE jusqu'au
 * chauffeur — c'est-à-dire qu'il ACCUSE DE FRAUDE un chauffeur honnête.
 *
 * Ces tests figent les deux garanties correspondantes.
 */
describe('Carburant — jamais de fausse accusation de fraude', () => {
  const mockPrisma = {
    fuelLog: { findFirst: jest.fn(), update: jest.fn() },
    gpsPosition: { findMany: jest.fn(), findFirst: jest.fn() },
    companyFuelSettings: { findUnique: jest.fn() },
  };
  const mockNotifications = { create: jest.fn() };
  const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const mockTrackingGateway = { broadcastDataUpdate: jest.fn() };

  let service: FuelConsumptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.companyFuelSettings.findUnique.mockResolvedValue({ crossCheckThreshold: 1.3 });
    service = new FuelConsumptionService(
      mockPrisma as unknown as PrismaService,
      { get: jest.fn().mockReturnValue(15) } as unknown as ConfigService,
      mockNotifications as unknown as NotificationsService,
      mockQueue as unknown as never,
      mockTrackingGateway as never,
    );
  });

  it('C1 — 2 h de GPS sur une fenêtre de 29 jours : « non vérifiable », JAMAIS « anomalie »', async () => {
    // Scénario réel : le chauffeur roule 600 km en 29 jours, mais son téléphone
    // n'a tracké que 2 h (éteint, batterie, permissions). AVANT le correctif, la
    // couverture était mesurée entre la PREMIÈRE et la DERNIÈRE position — soit
    // sur ces 2 h — et valait donc ~100 % : le garde-fou ne se déclenchait pas,
    // le ratio 600/15 = 40× levait une anomalie de priorité HAUTE.
    const prevFill = new Date('2026-08-01T08:00:00.000Z');
    const currentFill = new Date('2026-08-30T08:00:00.000Z');

    // Trace dense mais courte : 2 h le 29 août, un fix par minute.
    const traceStart = new Date('2026-08-29T06:00:00.000Z');
    const positions = Array.from({ length: 121 }, (_, i) => ({
      latitude: -18.8792 + i * 0.001,
      longitude: 47.5079,
      accuracy: 10,
      speed: 8,
      timestamp: new Date(traceStart.getTime() + i * 60_000),
    }));

    mockPrisma.fuelLog.findFirst.mockResolvedValue({ fillDate: prevFill });
    mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(positions);
    mockPrisma.gpsPosition.findFirst.mockResolvedValue({ timestamp: traceStart });

    await (
      service as never as { crossCheckFuelLogWithGps: (l: unknown, c: string) => Promise<void> }
    ).crossCheckFuelLogWithGps(
      {
        id: 'fuel-log-1',
        vehicleId: 'vehicle-a',
        kilometers: 600,
        fillDate: currentFill,
        vehicle: { licensePlate: 'HONEST-1', driver: { userId: 'user-1' } },
        gpsCoverageInsufficientFlag: false,
        gpsAnomalyFlag: false,
      },
      'company-1',
    );

    // AUCUNE accusation de sur-déclaration.
    expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ gpsAnomalyFlag: true }) }),
    );
    // Le verdict correct est « non vérifiable ».
    expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gpsCoverageInsufficientFlag: true }),
      }),
    );
  });

  it('C3 — une anomalie GPS est LEVÉE quand le kilométrage revient dans la tolérance', async () => {
    // AVANT le correctif, gpsAnomalyFlag n'était remis à false NULLE PART : une
    // fois posé, il restait en base pour toujours — l'anomalie affichée devenait
    // définitivement fausse après correction de la saisie.
    const prevFill = new Date('2026-08-01T00:00:00.000Z');
    const currentFill = new Date('2026-08-01T02:00:00.000Z');

    // Trace couvrant toute la fenêtre, ~10 km parcourus.
    const positions = Array.from({ length: 121 }, (_, i) => ({
      latitude: -18.8792 + i * (10 / 111.32 / 120),
      longitude: 47.5079,
      accuracy: 8,
      speed: 5,
      timestamp: new Date(prevFill.getTime() + i * 60_000),
    }));

    mockPrisma.fuelLog.findFirst.mockResolvedValue({ fillDate: prevFill });
    mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(positions);
    mockPrisma.gpsPosition.findFirst.mockResolvedValue({ timestamp: prevFill });

    await (
      service as never as { crossCheckFuelLogWithGps: (l: unknown, c: string) => Promise<void> }
    ).crossCheckFuelLogWithGps(
      {
        id: 'fuel-log-2',
        vehicleId: 'vehicle-a',
        kilometers: 10, // cohérent avec le GPS → ratio ≈ 1
        fillDate: currentFill,
        vehicle: { licensePlate: 'FIXED-1', driver: { userId: 'user-1' } },
        gpsCoverageInsufficientFlag: false,
        // Anomalie posée par un check ANTÉRIEUR, avant correction de la saisie.
        gpsAnomalyFlag: true,
      },
      'company-1',
    );

    expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gpsAnomalyFlag: false, gpsAnomalyReason: null }),
      }),
    );
  });
});
