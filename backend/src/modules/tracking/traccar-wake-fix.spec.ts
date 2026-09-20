import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

// =============================================================================
// « TÉLÉPORTATION » AU RÉVEIL DU TRACEUR (audit 2026-09-20).
// Cas réel : véhicule garé à la maison (dernier fix fiable 15:19:39, 15 satellites).
// À 15:53:03 puis 15:53:08 le GT06 se réveille et envoie deux fixes à 7 satellites, à
// ~430 m de la vraie position. Avant correctif : acceptés (minimum 4 satellites), stockés
// (→ « trajet » fantôme de 430 m) et affichés (le 2e « corroborait » le 1er).
// =============================================================================

const mockRedis = {
  call: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  lpush: jest.fn(),
  ltrim: jest.fn(),
  lrange: jest.fn(),
  lrem: jest.fn(),
  llen: jest.fn(),
};
const mockPrisma = {
  vehicle: { findMany: jest.fn(), findFirst: jest.fn() },
  delivery: { findFirst: jest.fn() },
  gpsPosition: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
  },
  vehicleAssignmentHistory: { findFirst: jest.fn() },
  driver: { findUnique: jest.fn() },
};
const mockTrackingService = {
  savePosition: jest.fn(),
  getLastPosition: jest.fn(),
  getCompanySettings: jest.fn(),
};
const mockGateway = { broadcastDataUpdate: jest.fn(), broadcastToCompany: jest.fn() };
const mockNotifications = { create: jest.fn() };

function createService() {
  const config = {
    get: jest.fn((key: string, d?: string) => {
      const m: Record<string, string> = {
        TRACCAR_URL: 'http://traccar-prod:8082',
        TRACCAR_USER: 'test',
        TRACCAR_PASSWORD: 'test',
      };
      return m[key] ?? (d as any);
    }),
  };
  return new TraccarBridgeService(
    config as unknown as ConfigService,
    mockPrisma as unknown as PrismaService,
    mockTrackingService as unknown as TrackingService,
    mockGateway as unknown as TrackingGateway,
    mockNotifications as unknown as NotificationsService,
    null,
    mockRedis as any,
  );
}

const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
const HOME = { latitude: -18.863258, longitude: 47.563883 };
const WRONG = { latitude: -18.862573, longitude: 47.567961 }; // ~430 m

describe('TraccarBridgeService — fixes de réveil peu fiables (audit 2026-09-20)', () => {
  let service: TraccarBridgeService;
  const now = Date.now();
  // dernier fix stocké : la maison, il y a 34 min
  const lastStoredAt = new Date(now - 34 * 60_000);

  const send = (secondsFromNow: number, sat: number, coords = WRONG) =>
    (service as any).handlePosition({
      id: Math.floor(Math.random() * 1e9),
      deviceId: 42,
      ...coords,
      speed: 0,
      course: 0,
      altitude: 0,
      accuracy: 0,
      valid: true,
      attributes: { sat, motion: true },
      fixTime: new Date(now + secondsFromNow * 1000).toISOString(),
      deviceTime: new Date(now + secondsFromNow * 1000).toISOString(),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => {});
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: VEHICLE_ID, companyId: 'c1' });
    mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue(null);
    mockPrisma.delivery.findFirst.mockResolvedValue(null);
    mockTrackingService.savePosition.mockResolvedValue({ id: 'g1', suspect: false });
    mockTrackingService.getLastPosition.mockResolvedValue({
      ...HOME,
      timestamp: lastStoredAt,
      accuracy: 8,
      speed: 0,
      attributes: { sat: 15 },
    });
  });

  it("DEUX fixes à 7 satellites après 34 min de silence : rien n'est stocké NI diffusé", async () => {
    await send(0, 7);
    await send(5, 7);
    expect(mockTrackingService.savePosition).not.toHaveBeenCalled();
    expect(mockGateway.broadcastToCompany).not.toHaveBeenCalled();
  });

  it('puis un fix fiable (15 satellites) : accepté et stocké, même loin (le véhicule a pu bouger)', async () => {
    await send(0, 7);
    await send(5, 7);
    await send(45, 15, { latitude: -18.8655, longitude: 47.5675 });
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
  });

  it('en trajet continu, un fix à 7 satellites 20 s après le précédent est accepté', async () => {
    mockTrackingService.getLastPosition.mockResolvedValue({
      ...HOME,
      timestamp: new Date(now - 20_000),
      accuracy: 8,
      speed: 3,
      attributes: { sat: 15 },
    });
    await send(0, 7);
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
  });

  it('ciel limité : des fixes faibles seuls sont libérés au bout de 2 min (traceur jamais bloqué)', async () => {
    await send(0, 7); // quarantaine
    expect(mockTrackingService.savePosition).not.toHaveBeenCalled();
    await send(125, 7); // > WAKE_QUARANTINE_MAX_S
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
  });

  it('fix de réveil à 15 satellites : accepté immédiatement (aucune régression du cas normal)', async () => {
    await send(0, 15, HOME);
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
  });
});
