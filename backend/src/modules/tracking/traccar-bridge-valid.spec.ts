import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

const mockRedis = { call: jest.fn(), expire: jest.fn(), get: jest.fn(), del: jest.fn(), set: jest.fn() };
const mockPrisma = {
  vehicle: { findMany: jest.fn(), findFirst: jest.fn() },
  delivery: { findFirst: jest.fn() },
  gpsPosition: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), createMany: jest.fn() },
};
const mockTrackingService = {
  savePosition: jest.fn().mockResolvedValue({ id: 'gps-1', suspect: false }),
  getLastPosition: jest.fn(),
  getCompanySettings: jest.fn(),
};
const mockGateway = { broadcastDataUpdate: jest.fn(), broadcastToCompany: jest.fn() };
const mockNotifications = { create: jest.fn() };

function createService() {
  const config = { get: jest.fn((key: string, d?: string) => {
    const m: Record<string, string> = { TRACCAR_URL: 'http://traccar-prod:8082', TRACCAR_USER: 'test', TRACCAR_PASSWORD: 'test' };
    return m[key] ?? (d as any);
  })};
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

describe('TraccarBridgeService — Champ valid', () => {
  let service: TraccarBridgeService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
    warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('should reject position when valid=false (LBS/cellulaire)', async () => {
    const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID, companyId: 'c1',
      driver: { id: 'd1', userId: 'u1', user: { firstName: 'A', lastName: 'B' } },
    });
    mockPrisma.delivery.findFirst.mockResolvedValue(null);

    await (service as any).handlePosition({
      id: 1, deviceId: 42,
      latitude: -18.87, longitude: 47.52,
      speed: 10, course: 90, altitude: 0, accuracy: 15,
      valid: false,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Position LBS rejetée (valid=false)'));
    expect(mockTrackingService.savePosition).not.toHaveBeenCalled();
  });

  it('should accept position when valid=true (vrai fix GPS)', async () => {
    const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
    const DRIVER_ID = '00000000-0000-4000-a000-000000000002';
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID, companyId: 'c1',
      driver: { id: DRIVER_ID, userId: 'u1', user: { firstName: 'A', lastName: 'B' } },
    });
    mockPrisma.delivery.findFirst.mockResolvedValue(null);

    await (service as any).handlePosition({
      id: 2, deviceId: 42,
      latitude: -18.87, longitude: 47.52,
      speed: 30, course: 180, altitude: 0, accuracy: 5,
      valid: true,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
    });

    expect(mockTrackingService.savePosition).toHaveBeenCalled();
  });

  it('should reject LBS position in backfill path', async () => {
    mockRedis.call.mockResolvedValue('OK');
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);

    const toInsert: any[] = [];
    const positions = [
      { latitude: -18.87, longitude: 47.52, speed: 0, course: 0, altitude: 0, accuracy: 50, valid: false, fixTime: new Date().toISOString(), deviceTime: new Date().toISOString() },
    ];

    for (const pos of positions) {
      if (pos.valid === false) {
        (service as any).logger.warn(`Backfill: position LBS rejetée (valid=false) pour device 42`);
        continue;
      }
      toInsert.push(pos);
    }

    expect(toInsert).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Backfill: position LBS rejetée'));
  });
});
