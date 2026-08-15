import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

// =============================================================================
// Durcissement Partie 1.2 — coupure serveur Traccar : la reconnexion + le
// backfill doivent couvrir la TOTALITÉ de la période de coupure, sans trou.
// =============================================================================

const VEHICLE_ID = '00000000-0000-4000-a000-000000000001';
const DEVICE_ID = 42;

// La coupure dure 10 minutes : le pont est déconnecté de T_OUTAGE_START à
// T_OUTAGE_END (aucune position reçue en temps réel pendant cette fenêtre).
const T_OUTAGE_START = Date.now() - 12 * 60 * 1000; // dernière position en base : -12 min
const T_OUTAGE_END = T_OUTAGE_START + 10 * 60 * 1000; // fin de coupure : -2 min

describe('TraccarBridgeService — reprise après coupure serveur : backfill SANS TROU', () => {
  let service: TraccarBridgeService;
  const redisStore = new Map<string, string>();
  let dbTimestamps: number[]; // timestamps (ms) déjà présents en base pour le véhicule
  let insertedByDriver: Map<number, string | null>; // timestamp → driverId inséré
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

  /** Génère les positions Traccar que le serveur a tamponnées pendant la coupure :
   *  une par minute sur TOUTE la fenêtre [T_START+1min, T_END], fixTime = heure GPS. */
  const positionsForOutageWindow = (startMs: number, endMs: number, stepMs = 60 * 1000) => {
    const positions = [];
    for (let t = startMs + stepMs; t <= endMs; t += stepMs) {
      positions.push({
        id: positions.length + 1,
        deviceId: DEVICE_ID,
        latitude: -18.87 + positions.length * 0.0001,
        longitude: 47.52 + positions.length * 0.0001,
        speed: 10,
        course: 90,
        altitude: 0,
        accuracy: 10,
        valid: true,
        fixTime: new Date(t).toISOString(),
        deviceTime: new Date(t).toISOString(),
      });
    }
    return positions;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    insertedByDriver = new Map();
    // La base contient la dernière position AVANT la coupure.
    dbTimestamps = [T_OUTAGE_START];
    redisStore.set(`traccar:last_position:${DEVICE_ID}`, new Date(T_OUTAGE_START).toISOString());

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
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([]);
    mockTrackingService.getLastPosition.mockResolvedValue({
      timestamp: new Date(T_OUTAGE_START),
      latitude: -18.87,
      longitude: 47.52,
    });
    mockPrisma.gpsPosition.findMany.mockImplementation(() =>
      Promise.resolve(dbTimestamps.map((t) => ({ timestamp: new Date(t) }))),
    );
    mockPrisma.gpsPosition.createMany.mockImplementation(({ data }: any) => {
      data.forEach((p: any) => {
        dbTimestamps.push(p.timestamp.getTime());
        insertedByDriver.set(p.timestamp.getTime(), p.driverId ?? null);
      });
      return Promise.resolve({ count: data.length });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('le backfill après reconnexion insère TOUTES les positions de la fenêtre de coupure (10 min), sans trou ni doublon', async () => {
    // Traccar (resté joignable par les traceurs pendant la coupure serveur du PONT)
    // a tamponné les positions : une par minute sur toute la fenêtre de 10 min.
    const windowPositions = positionsForOutageWindow(T_OUTAGE_START, T_OUTAGE_END);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => windowPositions,
    });

    await (service as any).performBackfill();

    expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
    const inserted = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    // 10 positions attendues (T_START+1min … T_END), AUCUNE perdue.
    expect(inserted).toHaveLength(10);

    const insertedTs = inserted.map((p: any) => new Date(p.timestamp).getTime());
    // Couverture COMPLÈTE de la fenêtre de coupure, pas de trou :
    // le 1er point est T_START+1min, le dernier T_END, espacés d'exactement 60s.
    expect(insertedTs[0]).toBe(T_OUTAGE_START + 60 * 1000);
    expect(insertedTs[insertedTs.length - 1]).toBe(T_OUTAGE_END);
    for (let i = 1; i < insertedTs.length; i++) {
      expect(insertedTs[i] - insertedTs[i - 1]).toBe(60 * 1000);
    }
    // L'ordre chronologique est strict (fixTime GPS, pas l'heure d'arrivée serveur).
    expect([...insertedTs].sort((a, b) => a - b)).toEqual(insertedTs);
    // La base contient maintenant 11 timestamps (1 avant coupure + 10 rattrapés), sans doublon.
    expect(new Set(dbTimestamps).size).toBe(11);

    // Second performBackfill (le serveur renvoie encore les mêmes positions) :
    // la clé Redis a été avancée → AUCUN doublon réinséré.
    mockPrisma.gpsPosition.createMany.mockClear();
    await (service as any).performBackfill();
    expect(mockPrisma.gpsPosition.createMany).not.toHaveBeenCalled();
    expect(dbTimestamps.length).toBe(11);
  });

  it('rattache chaque position backfillée à la livraison ACTIVE AU MOMENT du fix (fenêtre createdAt..completedAt) — pas de position perdue pour le rapport de trajet', async () => {
    // Livraison du chauffeur résolu : créée avant la coupure, non terminée pendant la
    // fenêtre → toutes les positions rattrapées doivent être rattachées à cet ID.
    const DELIVERY_ID = '00000000-0000-4000-a000-0000000000dd';
    mockPrisma.delivery.findMany.mockResolvedValue([
      {
        id: DELIVERY_ID,
        driverId: '00000000-0000-4000-a000-00000000000a',
        createdAt: new Date(T_OUTAGE_START - 3600 * 1000),
        completedAt: null,
      },
    ]);
    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([
      {
        driverId: '00000000-0000-4000-a000-00000000000a',
        assignedAt: new Date(0),
        unassignedAt: null,
      },
    ]);

    const windowPositions = positionsForOutageWindow(T_OUTAGE_START, T_OUTAGE_END);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => windowPositions,
    });

    await (service as any).performBackfill();

    const inserted = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    expect(inserted).toHaveLength(10);
    // TOUTES les positions rattrapées sont rattachées à la livraison active au fix
    // (aucune n'est enregistrée avec deliveryId null → aucune ne disparaît du rapport).
    for (const p of inserted) {
      expect(p.deliveryId).toBe(DELIVERY_ID);
    }
  });

  it('attribue le bon chauffeur à CHAQUE position backfillée même si le véhicule a été réaffecté PENDANT la coupure', async () => {
    // Réaffectation au milieu de la coupure (5 min après le début).
    const SWITCH_TIME = T_OUTAGE_START + 5 * 60 * 1000;
    const OLD_DRIVER = '00000000-0000-4000-a000-00000000000a';
    const NEW_DRIVER = '00000000-0000-4000-a000-00000000000b';

    mockPrisma.vehicleAssignmentHistory.findMany.mockResolvedValue([
      { driverId: OLD_DRIVER, assignedAt: new Date(0), unassignedAt: new Date(SWITCH_TIME) },
      { driverId: NEW_DRIVER, assignedAt: new Date(SWITCH_TIME), unassignedAt: null },
    ]);

    const windowPositions = positionsForOutageWindow(T_OUTAGE_START, T_OUTAGE_END);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => windowPositions,
    });

    await (service as any).performBackfill();

    const inserted = (mockPrisma.gpsPosition.createMany.mock.calls[0][0] as any).data;
    expect(inserted).toHaveLength(10);
    for (const p of inserted) {
      const t = new Date(p.timestamp).getTime();
      // Chaque position est attribuée au chauffeur EN VIGUEUR à l'instant de SON fix GPS :
      // avant le switch → ANCIEN chauffeur, après → NOUVEAU. Aucune position perdue ni
      // mal attribuée à cause de la réaffectation pendant la coupure.
      expect(p.driverId).toBe(t < SWITCH_TIME ? OLD_DRIVER : NEW_DRIVER);
    }
  });
});
