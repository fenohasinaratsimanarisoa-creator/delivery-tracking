import { ConfigService } from '@nestjs/config';
import { TrackingService } from './tracking.service';
import { TraccarBridgeService } from './traccar-bridge.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { PrismaService } from '../../common/prisma/prisma.service';

// =============================================================================
// FIDÉLITÉ EXACTE DU TRAJET ENREGISTRÉ (Partie 2, point 5) — test de bout en bout.
//
// Scénario simulé :
//  - Livraison PHONE : coupure réseau app mobile de 5 min EN PLEIN MILIEU du
//    trajet (positions capturées localement par la file offline, flushées après
//    reconnexion → AUCUN trou) + changement de chauffeur (D1 → D2) en cours de
//    trajet.
//  - Livraison TRACEUR : coupure serveur Traccar de 10 min (le pont est
//    déconnecté ; le traceur tamponne ; au retour, le backfill rattrape la
//    fenêtre) + trou GPS RÉEL de 4 min (device sans fix) + changement de
//    chauffeur PENDANT la coupure (résolu via VehicleAssignmentHistory).
//
// Vérifications : getTripReport()/getAllPositionsByDelivery() restituent
// l'INTÉGRALITÉ du trajet réel, dans l'ordre chronologique strict (fixTime GPS),
// sans point manquant ni dupliqué, avec le bon chauffeur par segment, et le trou
// réel est signalé (signalGaps) sans que la file offline en crée un faux.
// =============================================================================

const COMPANY_ID = '00000000-0000-4000-0000-0000000000c1';
const DELIVERY_PHONE = '00000000-0000-4000-0000-0000000000d1';
const DELIVERY_TRACKER = '00000000-0000-4000-0000-0000000000d2';
const VEHICLE_PHONE = '00000000-0000-4000-0000-0000000000v1';
const VEHICLE_TRACKER = '00000000-0000-4000-0000-0000000000v2';
const DRIVER_D1 = '00000000-0000-4000-0000-0000000000a1';
const USER_D1 = '00000000-0000-4000-0000-0000000000u1';
const DRIVER_D2 = '00000000-0000-4000-0000-0000000000a2';
const USER_D2 = '00000000-0000-4000-0000-0000000000u2';
const TRACCAR_DEVICE_ID = 77;

const T0 = Date.parse('2026-07-21T10:00:00.000Z');

// ---------------------------------------------------------------------------
// Faux store Prisma "fidèle" : les requêtes s'exécutent sur des stores en
// mémoire avec une vraie sémantique de filtrage/tri.
// ---------------------------------------------------------------------------

interface PosRow {
  id: string;
  vehicleId: string;
  deliveryId: string | null;
  companyId: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  accuracy: number | null;
  suspect: boolean;
  timestamp: Date;
  driverId: string | null;
  source: string;
}

let posSeq = 0;
const posStore: PosRow[] = [];

const deliveries = [
  {
    id: DELIVERY_PHONE,
    companyId: COMPANY_ID,
    title: 'Livraison Phone',
    status: 'in_progress',
    pickupAddress: 'Dépôt',
    deliveryAddress: 'Client A',
    pickupLat: null,
    pickupLng: null,
    deliveryLat: null,
    deliveryLng: null,
    scheduledDate: new Date(T0 + 24 * 3600 * 1000),
    publicTrackingRevokedAt: null,
    deletedAt: null,
    vehicleId: VEHICLE_PHONE,
    driverId: DRIVER_D1,
    assignedDriverId: USER_D1,
    createdAt: new Date(T0 - 3600 * 1000),
    completedAt: null,
  },
  {
    id: DELIVERY_TRACKER,
    companyId: COMPANY_ID,
    title: 'Livraison Traceur',
    status: 'in_progress',
    pickupAddress: 'Dépôt',
    deliveryAddress: 'Client B',
    pickupLat: null,
    pickupLng: null,
    deliveryLat: null,
    deliveryLng: null,
    scheduledDate: new Date(T0 + 24 * 3600 * 1000),
    publicTrackingRevokedAt: null,
    deletedAt: null,
    vehicleId: VEHICLE_TRACKER,
    driverId: DRIVER_D1,
    assignedDriverId: USER_D1,
    createdAt: new Date(T0 - 3600 * 1000),
    completedAt: null,
  },
];

const vehicles = [
  {
    id: VEHICLE_PHONE,
    companyId: COMPANY_ID,
    licensePlate: 'PHONE-1',
    brand: 'Marque',
    model: 'Modèle',
    positionSource: 'phone',
    isActive: true,
    deletedAt: null,
    createdAt: new Date(0),
    traccarDeviceId: null,
    driver: { id: DRIVER_D1, userId: USER_D1 },
  },
  {
    id: VEHICLE_TRACKER,
    companyId: COMPANY_ID,
    licensePlate: 'TRACK-1',
    brand: 'Marque',
    model: 'Modèle',
    positionSource: 'physical_tracker',
    isActive: true,
    deletedAt: null,
    createdAt: new Date(0),
    traccarDeviceId: String(TRACCAR_DEVICE_ID),
    driver: { id: DRIVER_D1, userId: USER_D1 },
  },
];

const SWITCH_TRACKER = new Date(T0 + 420 * 1000); // réaffectation PENDANT la coupure
const assignmentHistory = [
  {
    driverId: DRIVER_D1,
    assignedAt: new Date(0),
    unassignedAt: SWITCH_TRACKER,
  },
  {
    driverId: DRIVER_D2,
    assignedAt: SWITCH_TRACKER,
    unassignedAt: null,
  },
];

const isNullCond = (cond: unknown) => cond === null || (typeof cond === 'object' && cond !== null && 'not' in cond && (cond as { not: unknown }).not === null);

const matchPos = (row: PosRow, where: any): boolean => {
  if (!where) return true;
  if (where.vehicleId) {
    if (typeof where.vehicleId === 'string' && row.vehicleId !== where.vehicleId) return false;
    if (where.vehicleId.in && !where.vehicleId.in.includes(row.vehicleId)) return false;
  }
  if (where.deliveryId && row.deliveryId !== where.deliveryId) return false;
  if (where.companyId && row.companyId !== where.companyId) return false;
  if (where.suspect !== undefined && row.suspect !== where.suspect) return false;
  if (where.delivery?.companyId && row.companyId !== where.delivery.companyId) return false;
  if (where.timestamp) {
    const t = row.timestamp.getTime();
    if (where.timestamp.gte && t < new Date(where.timestamp.gte).getTime()) return false;
    if (where.timestamp.lte && t > new Date(where.timestamp.lte).getTime()) return false;
  }
  return true;
};

const insertRows = (data: any[]): PosRow[] => {
  const created: PosRow[] = data.map((d) => {
    const row: PosRow = {
      id: `pos-${++posSeq}`,
      vehicleId: d.vehicleId,
      deliveryId: d.deliveryId ?? null,
      companyId: d.companyId,
      latitude: d.latitude,
      longitude: d.longitude,
      speed: d.speed ?? null,
      heading: d.heading ?? null,
      altitude: d.altitude ?? null,
      accuracy: d.accuracy ?? null,
      suspect: d.suspect ?? false,
      timestamp: d.timestamp instanceof Date ? d.timestamp : new Date(d.timestamp),
      driverId: d.driverId ?? null,
      source: d.source,
    };
    posStore.push(row);
    return row;
  });
  return created;
};

const mockPrisma: any = {
  driver: {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === DRIVER_D1) return { id: DRIVER_D1, userId: USER_D1 };
      if (where.id === DRIVER_D2) return { id: DRIVER_D2, userId: USER_D2 };
      return null;
    }),
    findFirst: jest.fn(async ({ where }: { where: any }) => {
      const isD1 = where.id === DRIVER_D1 || where.userId === USER_D1;
      const isD2 = where.id === DRIVER_D2 || where.userId === USER_D2;
      return isD1 ? { id: DRIVER_D1, userId: USER_D1 } : isD2 ? { id: DRIVER_D2, userId: USER_D2 } : null;
    }),
  },
  vehicle: {
    findMany: jest.fn(async ({ where }: { where: any }) => {
      return vehicles.filter((v: any) => {
        if (where?.id?.in && !where.id.in.includes(v.id)) return false;
        if (where?.companyId && v.companyId !== where.companyId) return false;
        if (where?.positionSource && v.positionSource !== where.positionSource) return false;
        if (where?.isActive !== undefined && v.isActive !== where.isActive) return false;
        if (where?.deletedAt !== undefined && v.deletedAt !== null) return false;
        if (where?.traccarDeviceId?.not && v.traccarDeviceId === null) return false;
        return true;
      });
    }),
    findFirst: jest.fn(),
  },
  delivery: {
    findMany: jest.fn(async ({ where }: { where: any }) => {
      return deliveries.filter((d: any) => {
        if (where?.id?.in && !where.id.in.includes(d.id)) return false;
        if (where?.vehicleId && d.vehicleId !== where.vehicleId) return false;
        if (where?.deletedAt !== undefined && d.deletedAt !== null) return false;
        if (where?.status?.in && !where.status.in.includes(d.status)) return false;
        if (where?.driverId?.in && !where.driverId.in.includes(d.driverId)) return false;
        if (where?.OR) {
          const ok = where.OR.some((o: any) =>
            (o.assignedDriverId && d.assignedDriverId === o.assignedDriverId) ||
            (o.driverId && d.driverId === o.driverId),
          );
          if (!ok) return false;
        }
        return true;
      });
    }),
    findFirst: jest.fn(async ({ where }: { where: any }) => {
      const found = deliveries.find((d: any) => {
        if (where?.id && d.id !== where.id) return false;
        if (where?.companyId && d.companyId !== where.companyId) return false;
        if (where?.driverId && d.driverId !== where.driverId) return false;
        if (where?.status && d.status !== where.status) return false;
        if (where?.deletedAt !== undefined && d.deletedAt !== null) return false;
        if (where?.deliveryLat?.not && d.deliveryLat === null) return false;
        if (where?.deliveryLng?.not && d.deliveryLng === null) return false;
        return true;
      });
      return found ?? null;
    }),
    findUnique: jest.fn(),
  },
  gpsPosition: {
    findMany: jest.fn(async ({ where, orderBy, distinct, take }: any) => {
      let rows = posStore.filter((r) => matchPos(r, where));
      if (distinct?.includes('vehicleId')) {
        const byV = new Map<string, PosRow>();
        for (const r of rows) {
          const prev = byV.get(r.vehicleId);
          if (!prev || r.timestamp.getTime() > prev.timestamp.getTime()) byV.set(r.vehicleId, r);
        }
        rows = [...byV.values()];
      }
      if (orderBy?.timestamp === 'asc') rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      else if (orderBy?.timestamp === 'desc') rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      if (take) rows = rows.slice(0, take);
      return rows;
    }),
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      let rows = posStore.filter((r) => matchPos(r, where));
      if (orderBy?.timestamp === 'desc') rows.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
      else rows.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return rows[0] ?? null;
    }),
    count: jest.fn(async ({ where }: any) => posStore.filter((r) => matchPos(r, where)).length),
    create: jest.fn(async ({ data }: any) => insertRows([data])[0]),
    createMany: jest.fn(async ({ data }: any) => {
      insertRows(data);
      return { count: data.length };
    }),
    createManyAndReturn: jest.fn(async ({ data }: any) => insertRows(data)),
  },
  vehicleAssignmentHistory: {
    findMany: jest.fn(async ({ where }: any) => {
      if (where?.vehicleId === VEHICLE_TRACKER) return assignmentHistory;
      return [];
    }),
    findFirst: jest.fn(),
  },
  companySettings: { findUnique: jest.fn().mockResolvedValue(null) },
  // Le calcul PostGIS n'est pas disponible dans ce test → repli sur la distance JS.
  $queryRaw: jest.fn().mockRejectedValue(new Error('postgis unavailable in test')),
};

// ---------------------------------------------------------------------------
// Mise en scène
// ---------------------------------------------------------------------------

describe('E2E fidélité du trajet — coupure mobile 5 min, coupure serveur 10 min, changement de chauffeur', () => {
  let trackingService: TrackingService;
  let bridge: TraccarBridgeService;
  const originalFetch = global.fetch;

  const mockNotifications = { create: jest.fn().mockResolvedValue({ id: 'n1' }) };
  const mockCache = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
  };
  const mockBus = { emit: jest.fn(), emitUpdate: jest.fn(), on: jest.fn() };
  const mockGateway = {
    broadcastToCompany: jest.fn(),
    broadcastDataUpdate: jest.fn(),
    sendToDriver: jest.fn(),
  } as any;
  const mockGeofence = { checkGeofences: jest.fn().mockResolvedValue([]), findForDelivery: jest.fn() } as any;

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

  /** Génère une position mobile (DTO saveBatch). */
  const phoneDto = (i: number, driverId: string) => ({
    latitude: -18.87 + i * 0.0001,
    longitude: 47.5 + i * 0.0001,
    speed: 8.33,
    heading: 90,
    altitude: 0,
    accuracy: 10,
    timestamp: new Date(T0 + i * 3000).toISOString(),
    vehicleId: VEHICLE_PHONE,
    deliveryId: DELIVERY_PHONE,
    driverId,
  });

  /** Génère une position Traccar (API serveur) à l'instant t — coordonnées valides. */
  const traccarApiPos = (t: number, id: number) => ({
    id,
    deviceId: TRACCAR_DEVICE_ID,
    latitude: -18.85 + id * 0.0002,
    longitude: 47.6 + id * 0.0002,
    speed: 10,
    course: 90,
    altitude: 0,
    accuracy: 10,
    valid: true,
    fixTime: new Date(t).toISOString(),
    deviceTime: new Date(t).toISOString(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    posSeq = 0;
    posStore.length = 0;

    const proximity = new DeliveryProximityService(
      mockPrisma as unknown as PrismaService,
      mockBus as unknown as DataUpdateBus,
      mockCache as unknown as CacheService,
      null,
    );

    trackingService = new TrackingService(
      mockPrisma as unknown as PrismaService,
      mockNotifications as unknown as NotificationsService,
      mockGeofence as unknown as GeofenceService,
      proximity,
      mockCache as unknown as CacheService,
      mockBus as unknown as DataUpdateBus,
      config as unknown as ConfigService,
    );

    bridge = new TraccarBridgeService(
      config as unknown as ConfigService,
      mockPrisma as unknown as PrismaService,
      trackingService as unknown as TrackingService,
      mockGateway as unknown as TrackingGateway,
      mockNotifications as unknown as NotificationsService,
      null,
      null, // pas de Redis dans le test
    );
    (bridge as any).sessionCookie = 'test-cookie';
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('restaure l\'INTÉGRALITÉ du trajet (mobile + traceur), dans l\'ordre, sans perte ni doublon, avec le bon chauffeur par segment', async () => {
    // ------------------------------------------------------------------ PHONE
    // Partie 1 (chauffeur D1) : 30 positions en temps réel, 3 s.
    const part1 = Array.from({ length: 30 }, (_, i) => phoneDto(i, DRIVER_D1));
    await trackingService.saveBatch(USER_D1, DRIVER_D1, part1, COMPANY_ID);

    // Partie 2 (D1) : coupure réseau 5 min (T0+90s → T0+390s). Les positions sont
    // CAPTURÉES LOCALEMENT (file offline) puis flushées APRÈS reconnexion, dans
    // l'ordre chronologique — le fixTime GPS est préservé, AUCUN trou dans les données.
    const part2 = Array.from({ length: 100 }, (_, i) => phoneDto(i + 30, DRIVER_D1));
    await trackingService.saveBatch(USER_D1, DRIVER_D1, part2, COMPANY_ID);

    // Partie 3 (chauffeur D2 — livraison réaffectée en cours de route) : 20 positions.
    deliveries[0].driverId = DRIVER_D2;
    deliveries[0].assignedDriverId = USER_D2;
    const part3 = Array.from({ length: 20 }, (_, i) => phoneDto(i + 130, DRIVER_D2));
    await trackingService.saveBatch(USER_D2, DRIVER_D2, part3, COMPANY_ID);

    // ------------------------------------------------------------- TRACEUR
    // Positions temps réel AVANT la coupure serveur (6 positions, 1/min, chauffeur D1).
    const preOutage = [0, 60, 120, 180, 240, 300].map((s) => ({
      vehicleId: VEHICLE_TRACKER,
      deliveryId: DELIVERY_TRACKER,
      companyId: COMPANY_ID,
      latitude: -18.85,
      longitude: 47.6,
      speed: 10,
      heading: 90,
      altitude: 0,
      accuracy: 10,
      suspect: false,
      timestamp: new Date(T0 + s * 1000),
      driverId: DRIVER_D1,
      source: 'physical_tracker',
    }));
    insertRows(preOutage);

    // Coupure serveur de 10 min (T0+300s → T0+900s) : le pont est déconnecté, le
    // traceur tamponne 1 position/min (T0+360s..T0+540s), puis TROU GPS RÉEL de 4 min
    // (device sans fix T0+540s..T0+780s), puis reprise (T0+840s, T0+900s).
    const buffered = [360, 420, 480, 540, 840, 900].map((s, idx) =>
      traccarApiPos(T0 + s * 1000, idx + 1),
    );
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => buffered });

    // Reconnexion → backfill de la fenêtre de coupure (avec réaffectation D1→D2 en
    // plein milieu à T0+420s, résolue via VehicleAssignmentHistory).
    await (bridge as any).performBackfill();

    // ------------------------------------------------------ VÉRIFICATIONS
    // 1. Rapport de la livraison PHONE : AUCUN point manquant.
    const phoneReport = await trackingService.getTripReport(DELIVERY_PHONE, COMPANY_ID);
    expect(phoneReport.positionCount).toBe(30 + 100 + 20); // 150 positions, rien perdu
    // Durée totale = premier → dernier fixTime GPS (T0 → T0+447s).
    expect(phoneReport.totalDurationSec).toBe(447);
    // La coupure réseau de 5 min n'a PAS créé de trou (file offline) :
    expect(phoneReport.signalInterrupted).toBe(false);
    expect(phoneReport.signalGaps).toHaveLength(0);
    // Deux chauffeurs ont conduit ce trajet (D1 puis D2) — attribués par segment.
    expect(phoneReport.uniqueDriverCount).toBe(2);

    const phonePositions = await trackingService.getAllPositionsByDelivery(
      DELIVERY_PHONE,
      COMPANY_ID,
    );
    expect(phonePositions).toHaveLength(150);
    // Ordre chronologique STRICT (fixTime GPS) — un backfill/retry arrivé en retard
    // garde sa place : chaque position est postérieure à la précédente.
    for (let i = 1; i < phonePositions.length; i++) {
      expect(phonePositions[i].timestamp.getTime()).toBeGreaterThan(
        phonePositions[i - 1].timestamp.getTime(),
      );
    }
    // AUCUN doublon de timestamp.
    const tsSet = new Set(phonePositions.map((p: any) => p.timestamp.getTime()));
    expect(tsSet.size).toBe(150);
    // Attribution du chauffeur par segment : D1 pour [0..129], D2 pour [130..149].
    for (let i = 0; i < phonePositions.length; i++) {
      const expected = i < 130 ? DRIVER_D1 : DRIVER_D2;
      expect(phonePositions[i].driverId).toBe(expected);
    }

    // 2. Rapport de la livraison TRACEUR : intégralité après backfill + trou réel signalé.
    const trackerReport = await trackingService.getTripReport(DELIVERY_TRACKER, COMPANY_ID);
    // 6 (avant coupure) + 6 (rattrapées par backfill) = 12, AUCUNE perdue.
    expect(trackerReport.positionCount).toBe(12);
    // Le trou GPS RÉEL de 4 min (T0+540s → T0+840s) est DÉTECTÉ et signalé.
    expect(trackerReport.signalInterrupted).toBe(true);
    expect(trackerReport.signalGaps).toHaveLength(1);
    const gap = trackerReport.signalGaps[0];
    expect(new Date(gap.fromTimestamp).getTime()).toBe(T0 + 540 * 1000);
    expect(new Date(gap.toTimestamp).getTime()).toBe(T0 + 840 * 1000);
    expect(gap.durationSec).toBe(300); // 5 min > seuil 3 min
    // Deux chauffeurs résolus au moment de chaque fix (D1 avant T0+420s, D2 après).
    expect(trackerReport.uniqueDriverCount).toBe(2);

    const trackerPositions = await trackingService.getAllPositionsByDelivery(
      DELIVERY_TRACKER,
      COMPANY_ID,
    );
    expect(trackerPositions).toHaveLength(12);
    for (let i = 1; i < trackerPositions.length; i++) {
      expect(trackerPositions[i].timestamp.getTime()).toBeGreaterThan(
        trackerPositions[i - 1].timestamp.getTime(),
      );
    }
    // Le backfill a bien rattaché les positions à la livraison (pas de deliveryId null)
    // ET attribué le bon chauffeur à chaque fix (D1 avant le switch, D2 après).
    for (const p of trackerPositions) {
      expect(p.deliveryId).toBe(DELIVERY_TRACKER);
      const t = p.timestamp.getTime();
      if (t < T0 + 420 * 1000) {
        expect(p.driverId).toBe(DRIVER_D1);
      } else {
        expect(p.driverId).toBe(DRIVER_D2);
      }
    }
  });
});
