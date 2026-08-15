import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

const mockRedis = {
  call: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
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
  savePosition: jest.fn().mockResolvedValue({ id: 'gps-1', suspect: false }),
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
      id: VEHICLE_ID,
      companyId: 'c1',
      driver: { id: 'd1', userId: 'u1', user: { firstName: 'A', lastName: 'B' } },
    });
    mockPrisma.delivery.findFirst.mockResolvedValue(null);

    await (service as any).handlePosition({
      id: 1,
      deviceId: 42,
      latitude: -18.87,
      longitude: 47.52,
      speed: 10,
      course: 90,
      altitude: 0,
      accuracy: 15,
      valid: false,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Position LBS rejetée (valid=false)'),
    );
    expect(mockTrackingService.savePosition).not.toHaveBeenCalled();
  });

  it('should accept position when valid=true (vrai fix GPS)', async () => {
    const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
    const DRIVER_ID = '00000000-0000-4000-a000-000000000002';
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID,
      companyId: 'c1',
      driver: { id: DRIVER_ID, userId: 'u1', user: { firstName: 'A', lastName: 'B' } },
    });
    // L'affectation couvre le moment du fix → driverId résolu depuis l'historique.
    mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue({ driverId: DRIVER_ID });
    mockPrisma.driver.findUnique.mockResolvedValue({
      user: { firstName: 'A', lastName: 'B' },
    });
    mockPrisma.delivery.findFirst.mockResolvedValue(null);

    await (service as any).handlePosition({
      id: 2,
      deviceId: 42,
      latitude: -18.87,
      longitude: 47.52,
      speed: 30,
      course: 180,
      altitude: 0,
      accuracy: 5,
      valid: true,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
    });

    expect(mockTrackingService.savePosition).toHaveBeenCalled();
  });

  it('should RECORD a real-time position when the vehicle has NO driver assigned at fix time (driverId null)', async () => {
    const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID,
      companyId: 'c1',
    });
    // Aucune ligne VehicleAssignmentHistory ne couvre l'instant du fix.
    mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue(null);
    mockPrisma.delivery.findFirst.mockResolvedValue(null);
    mockTrackingService.savePosition.mockImplementation(
      async (driverId: string | null, dto: any) => ({
        id: 'gps-nodriver',
        suspect: false,
        driverId,
        vehicleId: dto.vehicleId,
      }),
    );

    await (service as any).handlePosition({
      id: 3,
      deviceId: 42,
      latitude: -18.87,
      longitude: 47.52,
      speed: 10,
      course: 90,
      altitude: 0,
      accuracy: 5,
      valid: true,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
    });

    // La position est ENREGISTRÉE (pas droppée) : driverId null, vehicleId présent.
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    const callArgs = mockTrackingService.savePosition.mock.calls[0];
    expect(callArgs[0]).toBeNull();
    expect(callArgs[1].vehicleId).toBe(VEHICLE_ID);
    expect(mockPrisma.driver.findUnique).not.toHaveBeenCalled();
  });

  // ─── Robustesse universelle (aucune hypothèse de protocole/marque) ─────────────
  const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';

  function mockMappedVehicle() {
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: VEHICLE_ID,
      companyId: 'c1',
    });
    // Aucune affectation couvrant l'instant du fix → driverId null.
    mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue(null);
    mockPrisma.delivery.findFirst.mockResolvedValue(null);
  }

  function basePos(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      deviceId: 42,
      latitude: -18.87,
      longitude: 47.52,
      speed: 10,
      course: 90,
      altitude: 0,
      accuracy: 15,
      fixTime: new Date().toISOString(),
      deviceTime: new Date().toISOString(),
      ...overrides,
    };
  }

  it("should ACCEPT a position whose valid field is undefined (protocoles qui ne l'envoient jamais)", async () => {
    mockMappedVehicle();
    const pos = basePos();
    delete (pos as any).valid;

    await (service as any).handlePosition(pos);

    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    // Aucun warning LBS : undefined ≠ false — la position passe (fix GPS par défaut).
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Position LBS rejetée'));
  });

  it('should clamp a fixTime in the FUTURE (> 300s) to server time (horloge traceur avancée)', async () => {
    mockMappedVehicle();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 min

    await (service as any).handlePosition(basePos({ fixTime: future, deviceTime: future }));

    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    const dto = mockTrackingService.savePosition.mock.calls[0][1];
    const tsMs = new Date(dto.timestamp).getTime();
    // Recadré sur l'heure serveur : l'écart avec now est inférieur à la tolérance (300s).
    expect(Math.abs(tsMs - Date.now())).toBeLessThan(5 * 60 * 1000);
  });

  it('should ignore an implausible hdop (garbage from low-end tracker) and keep device accuracy', async () => {
    mockMappedVehicle();

    await (service as any).handlePosition(basePos({ accuracy: 5, attributes: { hdop: 250 } }));

    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    const dto = mockTrackingService.savePosition.mock.calls[0][1];
    // hdop=250 ignoré (hors plage plausible) → accuracy du device conservée.
    expect(dto.accuracy).toBe(5);
  });

  it('should fall back to 50m when neither accuracy nor hdop is provided (device minimaliste)', async () => {
    mockMappedVehicle();
    const pos = basePos();
    delete (pos as any).accuracy;

    await (service as any).handlePosition(pos);

    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    const dto = mockTrackingService.savePosition.mock.calls[0][1];
    expect(dto.accuracy).toBe(50);
  });

  it('should clamp an accuracy > 1000 to 1000 so the position is NOT rejected by DTO validation', async () => {
    mockMappedVehicle();

    await (service as any).handlePosition(basePos({ accuracy: 5000 }));

    // La position est SAUVÉE (jamais rejetée par validateSync @Max(1000)) avec accuracy clampée.
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(1);
    const dto = mockTrackingService.savePosition.mock.calls[0][1];
    expect(dto.accuracy).toBe(1000);
  });

  it('should process a BURST of rapid positions without losing or throttling any (rafale Teltonika)', async () => {
    mockMappedVehicle();
    mockTrackingService.savePosition.mockResolvedValue({ id: 'gps-1', suspect: false });

    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await (service as any).handlePosition(
        basePos({
          id: 100 + i,
          latitude: -18.87 + i * 0.0001,
          longitude: 47.52 + i * 0.0001,
          fixTime: new Date(now - (2 - i) * 1000).toISOString(),
        }),
      );
    }

    // Aucune position légitime perdue : 3 savePosition pour 3 positions reçues.
    expect(mockTrackingService.savePosition).toHaveBeenCalledTimes(3);
  });

  it('should reject LBS position in backfill path', async () => {
    mockRedis.call.mockResolvedValue('OK');
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);

    const toInsert: any[] = [];
    const positions = [
      {
        latitude: -18.87,
        longitude: 47.52,
        speed: 0,
        course: 0,
        altitude: 0,
        accuracy: 50,
        valid: false,
        fixTime: new Date().toISOString(),
        deviceTime: new Date().toISOString(),
      },
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
