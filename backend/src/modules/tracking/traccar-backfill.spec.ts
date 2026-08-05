import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
const DRIVER_ID = '00000000-0000-4000-a000-000000000002';
const DEVICE_ID = 42;

// Timestamps relatifs à l'horloge du test : must rester dans la fenêtre
// BACKFILL_MAX_HOURS (24h) pour que la borne `from` calculée soit bien
// lastTs+1s et non la limite now-24h.
const P1_TIME = new Date(Date.now() - 120000).toISOString(); // dernière position connue en base (2 min)
const P2_TIME = new Date(Date.now() - 60000).toISOString(); // nouvelle position à rattraper (1 min)

const backfillPositions = [
  {
    id: 1,
    deviceId: DEVICE_ID,
    latitude: -18.87,
    longitude: 47.52,
    speed: 10,
    course: 90,
    altitude: 0,
    accuracy: 10,
    valid: true,
    fixTime: P1_TIME,
    deviceTime: P1_TIME,
  },
  {
    id: 2,
    deviceId: DEVICE_ID,
    latitude: -18.88,
    longitude: 47.53,
    speed: 12,
    course: 100,
    altitude: 0,
    accuracy: 10,
    valid: true,
    fixTime: P2_TIME,
    deviceTime: P2_TIME,
  },
];

describe('TraccarBridgeService — performBackfill déduplication', () => {
  let service: TraccarBridgeService;
  const redisStore = new Map<string, string>();
  let dbTimestamps: number[];
  const originalFetch = global.fetch;

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
  };

  const mockTrackingService = {
    savePosition: jest.fn().mockResolvedValue({ id: 'gps-1', suspect: false }),
    getLastPosition: jest.fn(),
    getCompanySettings: jest.fn(),
  };

  const mockGateway = { broadcastDataUpdate: jest.fn(), broadcastToCompany: jest.fn() };
  const mockNotifications = { create: jest.fn() };

  const mockRedis = {
    call: jest.fn(),
    expire: jest.fn(),
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    del: jest.fn(),
    set: jest.fn(async (key: string, value: string) => {
      redisStore.set(key, value);
      return 'OK';
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    // La base contient déjà la dernière position connue (P1).
    dbTimestamps = [new Date(P1_TIME).getTime()];

    const config = {
      get: jest.fn((key: string, d?: string) => {
        const m: Record<string, string> = {
          TRACCAR_URL: 'http://traccar-test:8082',
          TRACCAR_USER: 't',
          TRACCAR_PASSWORD: 't',
        };
        return m[key] ?? (d as any);
      }),
    };

    service = new TraccarBridgeService(
      config as unknown as ConfigService,
      mockPrisma as unknown as PrismaService,
      mockTrackingService as unknown as TrackingService,
      mockGateway as unknown as TrackingGateway,
      mockNotifications as unknown as NotificationsService,
      null,
      mockRedis as any,
    );
    (service as any).sessionCookie = 'test-cookie';

    mockPrisma.vehicle.findMany.mockResolvedValue([
      {
        id: VEHICLE_ID,
        traccarDeviceId: String(DEVICE_ID),
        companyId: 'c1',
        driver: { id: DRIVER_ID },
      },
    ]);
    mockTrackingService.getLastPosition.mockResolvedValue({
      timestamp: new Date(P1_TIME),
      latitude: -18.87,
      longitude: 47.52,
    });
    // L'API Traccar renvoie les MÊMES positions à chaque appel (comportement mocké).
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => backfillPositions });

    // gpsPosition.findMany = contenu courant de la base pour le véhicule.
    mockPrisma.gpsPosition.findMany.mockImplementation(() =>
      Promise.resolve(dbTimestamps.map((t) => ({ timestamp: new Date(t) }))),
    );
    // createMany = insertion réelle dans la "base" simulée.
    mockPrisma.gpsPosition.createMany.mockImplementation(({ data }: any) => {
      data.forEach((p: any) => dbTimestamps.push(p.timestamp.getTime()));
      return Promise.resolve({ count: data.length });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('ne réinsère aucun doublon au second performBackfill (COUNT avant/après identique)', async () => {
    await (service as any).performBackfill();

    // 1er appel : seule la nouvelle position P2 est insérée (P1 est déjà en base).
    expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
    const inserted1 = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    expect(inserted1).toHaveLength(1);
    expect(new Date(inserted1[0].timestamp).toISOString()).toBe(P2_TIME);
    const countAfterFirst = dbTimestamps.length; // P1 + P2

    // 2e appel avec les MÊMES positions renvoyées par l'API Traccar.
    mockPrisma.gpsPosition.createMany.mockClear();
    await (service as any).performBackfill();

    // La clé Redis a été mise à jour → marge +1s → aucun doublon inséré.
    expect(mockPrisma.gpsPosition.createMany).not.toHaveBeenCalled();
    expect(dbTimestamps.length).toBe(countAfterFirst);

    // Preuve de la marge : le `from` du 2e fetch démarre après la dernière position connue.
    const fetchCalls = (global.fetch as jest.Mock).mock.calls;
    const secondFrom = new URL(fetchCalls[1][0] as string).searchParams.get('from');
    expect(new Date(secondFrom as string).getTime()).toBe(new Date(P2_TIME).getTime() + 1000);

    // La requête de dédoublonnage est groupée (une seule findMany par véhicule et par lot).
    const dedupCalls = mockPrisma.gpsPosition.findMany.mock.calls;
    for (const args of dedupCalls) {
      expect(args[0]).toMatchObject({
        where: {
          vehicleId: VEHICLE_ID,
          timestamp: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
        },
      });
    }
  });

  it("attribue l'ANCIEN driverId aux positions antérieures au changement de chauffeur et le NOUVEAU aux postérieures (résolution via VehicleAssignmentHistory)", async () => {
    // Changement de chauffeur au milieu de la fenêtre de rattrapage.
    const SWITCH_TIME = new Date(Date.now() - 90 * 60000); // il y a 90 min
    const OLD_DRIVER = '00000000-0000-4000-a000-00000000000a';
    const NEW_DRIVER = '00000000-0000-4000-a000-00000000000b';

    const P_OLD_TIME = new Date(Date.now() - 120 * 60000); // 120 min : AVANT le changement
    const P_NEW_TIME = new Date(Date.now() - 30 * 60000); // 30 min : APRÈS le changement

    mockPrisma.vehicle.findMany.mockResolvedValue([
      { id: VEHICLE_ID, traccarDeviceId: String(DEVICE_ID), companyId: 'c1' },
    ]);
    mockTrackingService.getLastPosition.mockResolvedValue(null);
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]); // aucun doublon
    mockPrisma.gpsPosition.createMany.mockImplementation(({ data }: any) =>
      Promise.resolve({ count: data.length }),
    );

    // Deux lignes VehicleAssignmentHistory se chevauchent avec le batch :
    // driver OLD couvre [.., SWITCH[, driver NEW couvre [SWITCH, ..].
    mockPrisma.vehicleAssignmentHistory.findFirst.mockImplementation(async ({ where }: any) => {
      const fixTime = where.assignedAt.lte as Date;
      return fixTime.getTime() < SWITCH_TIME.getTime()
        ? { driverId: OLD_DRIVER }
        : { driverId: NEW_DRIVER };
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          deviceId: DEVICE_ID,
          latitude: -18.87,
          longitude: 47.52,
          speed: 10,
          course: 90,
          altitude: 0,
          accuracy: 10,
          valid: true,
          fixTime: P_OLD_TIME.toISOString(),
          deviceTime: P_OLD_TIME.toISOString(),
        },
        {
          id: 2,
          deviceId: DEVICE_ID,
          latitude: -18.88,
          longitude: 47.53,
          speed: 12,
          course: 100,
          altitude: 0,
          accuracy: 10,
          valid: true,
          fixTime: P_NEW_TIME.toISOString(),
          deviceTime: P_NEW_TIME.toISOString(),
        },
      ],
    });

    await (service as any).performBackfill();

    expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
    const inserted = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    expect(inserted).toHaveLength(2);
    const byTime = new Map(inserted.map((p: any) => [new Date(p.timestamp).getTime(), p.driverId]));
    // Position antérieure au changement → ANCIEN driver ; postérieure → NOUVEAU.
    expect(byTime.get(P_OLD_TIME.getTime())).toBe(OLD_DRIVER);
    expect(byTime.get(P_NEW_TIME.getTime())).toBe(NEW_DRIVER);
  });
});
