import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
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
    delivery: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    gpsPosition: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    vehicleAssignmentHistory: { findFirst: jest.fn(), findMany: jest.fn() },
  };

  const mockTrackingService = {
    savePosition: jest.fn().mockResolvedValue({ id: 'gps-1', suspect: false }),
    getLastPosition: jest.fn(),
    getCompanySettings: jest.fn(),
    replayBackfillSideEffects: jest.fn().mockResolvedValue(undefined),
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
    // Aucun historique d'affectation par défaut (résolution driverId = null).
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([]);
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
    // Par défaut aucun historique d'affectation (résolution null hors scénario dédié).
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([]);
    mockPrisma.gpsPosition.createMany.mockImplementation(({ data }: any) =>
      Promise.resolve({ count: data.length }),
    );

    // Deux lignes VehicleAssignmentHistory se chevauchent avec le batch :
    // driver OLD couvre [.., SWITCH[, driver NEW couvre [SWITCH, ..]. Le backfill charge
    // l'historique en UNE requête (findMany) puis résout chaque fix en mémoire.
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([
      {
        driverId: OLD_DRIVER,
        assignedAt: new Date(0),
        unassignedAt: SWITCH_TIME,
      },
      {
        driverId: NEW_DRIVER,
        assignedAt: SWITCH_TIME,
        unassignedAt: null,
      },
    ]);

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

  it('rejoue proximité + géofences sur le DERNIER point fiable inséré (parité saveBatch)', async () => {
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);
    await (service as any).performBackfill();

    expect(mockTrackingService.replayBackfillSideEffects).toHaveBeenCalledTimes(1);
    const arg = mockTrackingService.replayBackfillSideEffects.mock.calls[0][0];
    expect(arg.vehicleId).toBe(VEHICLE_ID);
    // P2 est la position la plus récente du lot.
    expect(new Date(arg.timestamp).toISOString()).toBe(P2_TIME);
  });

  it('un point suspect (téléportation) ne devient PAS la référence du point suivant', async () => {
    // Base fiable en (-18.87, 47.52) il y a 3 min.
    const T0 = new Date(Date.now() - 180000);
    const T1 = new Date(Date.now() - 120000);
    const T2 = new Date(Date.now() - 60000);
    const T3 = new Date(Date.now() - 30000);
    mockTrackingService.getLastPosition.mockResolvedValue({
      timestamp: T0,
      latitude: -18.87,
      longitude: 47.52,
      accuracy: 10,
    });
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);
    mockPrisma.vehicle.findMany.mockResolvedValue([
      { id: VEHICLE_ID, traccarDeviceId: String(DEVICE_ID), companyId: 'c1' },
    ]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        // T1 : proche de la base → fiable
        {
          id: 1,
          deviceId: DEVICE_ID,
          latitude: -18.871,
          longitude: 47.521,
          speed: 8,
          course: 90,
          altitude: 0,
          accuracy: 10,
          valid: true,
          fixTime: T1.toISOString(),
          deviceTime: T1.toISOString(),
        },
        // T2 : saut de ~600 km en 1 min → SUSPECT
        {
          id: 2,
          deviceId: DEVICE_ID,
          latitude: -12.0,
          longitude: 45.0,
          speed: 0,
          course: 0,
          altitude: 0,
          accuracy: 10,
          valid: true,
          fixTime: T2.toISOString(),
          deviceTime: T2.toISOString(),
        },
        // T3 : de retour près de la base → doit être FIABLE (comparé à T1, pas à T2)
        {
          id: 3,
          deviceId: DEVICE_ID,
          latitude: -18.872,
          longitude: 47.522,
          speed: 8,
          course: 90,
          altitude: 0,
          accuracy: 10,
          valid: true,
          fixTime: T3.toISOString(),
          deviceTime: T3.toISOString(),
        },
      ],
    });

    await (service as any).performBackfill();

    const inserted = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    const byTime = new Map(inserted.map((p: any) => [new Date(p.timestamp).getTime(), p.suspect]));
    expect(byTime.get(T1.getTime())).toBe(false);
    expect(byTime.get(T2.getTime())).toBe(true); // le saut
    expect(byTime.get(T3.getTime())).toBe(false); // retour : PAS un 2e faux positif
  });
});

describe('TraccarBridgeService — sérialisation PAR DEVICE (backfill vs flux live)', () => {
  let service: TraccarBridgeService;
  const redisStore = new Map<string, string>();
  const VEHICLE_ID2 = '00000000-0000-4000-a000-000000000003';
  const originalFetch = global.fetch;

  const mockPrisma = {
    vehicle: { findMany: jest.fn(), findFirst: jest.fn() },
    delivery: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    gpsPosition: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    vehicleAssignmentHistory: { findFirst: jest.fn(), findMany: jest.fn() },
  };

  const mockTrackingService = {
    savePosition: jest.fn().mockResolvedValue({ id: 'gps-1', suspect: false }),
    getLastPosition: jest.fn().mockResolvedValue(null),
    getCompanySettings: jest.fn(),
    replayBackfillSideEffects: jest.fn().mockResolvedValue(undefined),
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

  const livePosition = (overrides: Record<string, unknown> = {}) => ({
    deviceId: DEVICE_ID,
    latitude: -18.8792,
    longitude: 47.5079,
    speed: 12,
    course: 90,
    altitude: 0,
    accuracy: 8,
    valid: true,
    fixTime: new Date().toISOString(),
    deviceTime: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();

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
      { id: VEHICLE_ID, traccarDeviceId: String(DEVICE_ID), companyId: 'c1' },
    ]);
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: VEHICLE_ID, companyId: 'c1' });
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([]);
    mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue(null);
    mockPrisma.gpsPosition.findMany.mockResolvedValue([]);
    mockPrisma.gpsPosition.createMany.mockResolvedValue({ count: 0 });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("backfill et position live pour le MÊME device ne s'exécutent jamais en même temps (le live attend le backfill)", async () => {
    const events: string[] = [];
    let resolveFetch!: (v: any) => void;
    // Le fetch REST du backfill reste en attente : le backfill tient le verrou
    // du device pendant cette section critique (lecture → écriture).
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    ) as any;

    mockPrisma.gpsPosition.createMany.mockImplementation(async ({ data }: any) => {
      events.push(`backfill:createMany:${data.length}`);
      return { count: data.length };
    });
    mockTrackingService.savePosition.mockImplementation(async () => {
      events.push('live:savePosition');
      return { id: 'gps-live', suspect: false };
    });

    const backfillPromise = (service as any).performBackfill();
    await new Promise((r) => setTimeout(r, 10)); // le backfill entre dans le fetch (verrou tenu)

    // Position live du MÊME device pendant que le backfill est en cours : le mutex
    // par device doit la BLOQUER (lecture "dernière position" → écriture protégées).
    const livePromise = (service as any).handlePosition(livePosition());
    await new Promise((r) => setTimeout(r, 10));
    expect(events).not.toContain('live:savePosition');

    // Libère le fetch : le backfill finit (insertion) PUIS le live est traité.
    resolveFetch({
      ok: true,
      json: async () => [livePosition({ id: 1, deviceId: DEVICE_ID })],
    });
    await backfillPromise;
    await livePromise;

    const ci = events.indexOf('backfill:createMany:1');
    const li = events.indexOf('live:savePosition');
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(li).toBeGreaterThan(ci);
    // La même position physique (même timestamp) n'est donc JAMAIS insérée deux fois
    // : les deux chemins sont sérialisés pour ce device.
    expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
  });

  it('deux devices DIFFÉRENTS restent traités en parallèle (verrou par device, pas global)', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValue([
      { id: VEHICLE_ID, traccarDeviceId: '42', companyId: 'c1' },
      { id: VEHICLE_ID2, traccarDeviceId: '43', companyId: 'c1' },
    ]);
    mockPrisma.vehicle.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.traccarDeviceId === '43' ? VEHICLE_ID2 : VEHICLE_ID,
        companyId: 'c1',
      }),
    );

    const events: string[] = [];
    let releaseDevice42!: () => void;
    mockTrackingService.savePosition.mockImplementation(async (_d: any, dto: any) => {
      if (dto.vehicleId === VEHICLE_ID) {
        events.push('d42:enter');
        await new Promise<void>((resolve) => {
          releaseDevice42 = resolve;
        });
        events.push('d42:exit');
        return { id: 'gps-42', suspect: false };
      }
      events.push('d43:done');
      return { id: 'gps-43', suspect: false };
    });

    // device 42 reste bloqué dans sa section critique (savePosition suspendue).
    const p42 = (service as any).handlePosition(livePosition({ deviceId: 42 }));
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toContain('d42:enter');

    // device 43 : ne doit PAS attendre device 42 (verrou par device).
    const p43 = (service as any).handlePosition(livePosition({ deviceId: 43 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toContain('d43:done');

    releaseDevice42();
    await p42;
    await p43;
    expect(events).toContain('d42:exit');
  });

  it('garde statique : la contrainte unique (vehicleId, timestamp) est déclarée dans le schéma ET appliquée par la migration', () => {
    const root = join(__dirname, '..', '..', '..');

    const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
    const gpsBlock = schema.slice(
      schema.indexOf('model GpsPosition {'),
      schema.indexOf('model GpsPositionArchive {'),
    );
    expect(gpsBlock).toContain('@@unique([vehicleId, timestamp])');

    const migrationsDir = join(root, 'prisma', 'migrations');
    const migrationDirs = readdirSync(migrationsDir).filter((d: string) =>
      d.includes('gps_position_unique_vehicle_timestamp'),
    );
    expect(migrationDirs.length).toBeGreaterThan(0);
    const sql = readFileSync(join(migrationsDir, migrationDirs[0], 'migration.sql'), 'utf8');
    // Dédup des doublons existants AVANT la création de l'index unique, sinon
    // la migration échouerait sur une base de production déjà polluée.
    expect(sql).toContain('DELETE FROM "gps_positions"');
    expect(sql).toContain('CREATE UNIQUE INDEX "gps_positions_vehicle_id_timestamp_key"');
  });
});
