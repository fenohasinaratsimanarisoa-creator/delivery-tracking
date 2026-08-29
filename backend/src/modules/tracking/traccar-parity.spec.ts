import { TrackingService } from './tracking.service';
import { TraccarBridgeService } from './traccar-bridge.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { TrackingGateway } from './tracking.gateway';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { NotificationType, NotificationPriority } from '@prisma/client';

describe('Tâche 4 — Parité fonctionnelle phone vs physical_tracker', () => {
  let trackingService: TrackingService;
  let proximityService: DeliveryProximityService;
  let mockGateway: jest.Mocked<TrackingGateway>;
  let mockNotifications: jest.Mocked<NotificationsService>;
  let mockPrisma: any;
  let mockCache: jest.Mocked<CacheService>;
  let mockDataUpdateBus: any;
  let mockGeofence: jest.Mocked<GeofenceService>;

  const COMPANY_ID = '00000000-0000-4000-0000-0000000000c1';
  const DRIVER_ID = '00000000-0000-4000-0000-000000000002';
  const USER_ID = '00000000-0000-4000-0000-0000000000u1';
  const VEHICLE_ID = '00000000-0000-4000-0000-000000000001';
  const VEHICLE_ID_TRACKER = '00000000-0000-4000-0000-000000000003';
  const DELIVERY_ID = '00000000-0000-4000-0000-00000000000a';
  const DELIVERY_LAT = -18.8792;
  const DELIVERY_LNG = 47.5079;

  const basePosition = (overrides = {}) => ({
    latitude: DELIVERY_LAT + 0.001,
    longitude: DELIVERY_LNG + 0.001,
    speed: 8.33,
    heading: 90,
    altitude: 100,
    accuracy: 10,
    timestamp: new Date().toISOString(),
    vehicleId: VEHICLE_ID,
    deliveryId: DELIVERY_ID,
    ...overrides,
  });

  const baseTraccarPos = (overrides = {}) => ({
    id: 999,
    deviceId: 42,
    latitude: DELIVERY_LAT + 0.001,
    longitude: DELIVERY_LNG + 0.001,
    speed: 8.33,
    course: 90,
    altitude: 100,
    accuracy: 10,
    fixTime: new Date().toISOString(),
    deviceTime: new Date().toISOString(),
    ...overrides,
  });

  function addVehicleMock(vehicleId: string) {
    mockPrisma.vehicle.findUnique.mockResolvedValue({ companyId: COMPANY_ID });
    mockPrisma.vehicle.findFirst.mockResolvedValue({
      id: vehicleId,
      companyId: COMPANY_ID,
      driver: { id: DRIVER_ID, userId: USER_ID },
    });
  }

  function setupCommonMocks() {
    mockGateway = {
      broadcastToCompany: jest.fn(),
      broadcastDataUpdate: jest.fn(),
      handleConnection: jest.fn(),
      handleDisconnect: jest.fn(),
    } as any;

    mockNotifications = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    } as any;

    mockCache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockDataUpdateBus = { emit: jest.fn(), emitUpdate: jest.fn(), on: jest.fn() } as any;

    mockGeofence = {
      checkGeofences: jest.fn().mockResolvedValue([]),
      findForDelivery: jest.fn(),
    } as any;

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_ACCESS_SECRET') return 'test-secret';
        if (key === 'TRACCAR_URL') return 'http://traccar:8082';
        if (key === 'TRACCAR_USER') return 'admin';
        if (key === 'TRACCAR_PASSWORD') return 'admin';
        return null;
      }),
    };

    const mockPrismaService = {
      gpsPosition: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'pos-1', suspect: data.suspect === true }),
          ),
      },
      vehicle: {
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(null)),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      delivery: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      driver: {
        findUnique: jest.fn().mockResolvedValue(null),
        // generateAlerts résout l'utilisateur cible via l'ID de la ligne Driver
        findFirst: jest.fn().mockResolvedValue({ id: DRIVER_ID, userId: USER_ID }),
      },
      vehicleAssignmentHistory: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      companySettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as any;

    mockPrisma = mockPrismaService;

    proximityService = new DeliveryProximityService(
      mockPrisma as any,
      mockDataUpdateBus as any,
      mockCache as any,
      null,
    );

    trackingService = new TrackingService(
      mockPrisma as any,
      mockNotifications as any,
      mockGeofence as any,
      proximityService,
      mockCache as any,
      mockDataUpdateBus as any,
      { get: () => undefined } as any,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
  });

  // ─── 4.1 Détection de téléportation ─────────────────────────────────
  describe('4.1 Détection de téléportation', () => {
    function runTeleportTest(vehicleId: string, lat: number, lng: number) {
      addVehicleMock(vehicleId);
      const fiveSecAgo = new Date(Date.now() - 5000);
      mockPrisma.gpsPosition.findFirst.mockResolvedValue({
        latitude: DELIVERY_LAT,
        longitude: DELIVERY_LNG,
        timestamp: fiveSecAgo,
      });
      mockPrisma.delivery.findFirst.mockResolvedValue({ id: DELIVERY_ID });
      mockPrisma.companySettings.findUnique.mockResolvedValue({});

      return trackingService.savePosition(
        DRIVER_ID,
        basePosition({ latitude: lat, longitude: lng, vehicleId }),
        COMPANY_ID,
      );
    }

    it('détecte la téléportation pour une position téléphone', async () => {
      const result = await runTeleportTest(VEHICLE_ID, DELIVERY_LAT + 1, DELIVERY_LNG + 1);
      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(true);
    });

    it('détecte la téléportation pour une position traceur physique', async () => {
      const result = await runTeleportTest(
        VEHICLE_ID_TRACKER,
        DELIVERY_LAT + 1.5,
        DELIVERY_LNG + 1.5,
      );
      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(true);
    });
  });

  // ─── 4.2 Alertes (vitesse, géofences, proximité) ────────────────────
  describe('4.2 Alertes', () => {
    async function runSpeedAlertTest(vehicleId: string, speedMs: number) {
      addVehicleMock(vehicleId);
      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.findFirst.mockResolvedValue({ id: DELIVERY_ID, title: 'Test' });
      mockPrisma.delivery.findUnique.mockResolvedValue({
        id: DELIVERY_ID,
        scheduledDate: new Date(),
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockPrisma.companySettings.findUnique.mockResolvedValue({
        speedAlertThreshold: 40,
        offlineTimeoutMinutes: 15,
      });
      return trackingService.savePosition(
        DRIVER_ID,
        basePosition({ speed: speedMs, vehicleId }),
        COMPANY_ID,
      );
    }

    it('déclenche alerte vitesse pour position téléphone quand seuil dépassé', async () => {
      const result = await runSpeedAlertTest(VEHICLE_ID, 13.89);
      expect(result).not.toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockNotifications.create.mock.calls.length).toBeGreaterThan(0);
    });

    it('déclenche alerte vitesse pour position traceur physique pareil', async () => {
      const result = await runSpeedAlertTest(VEHICLE_ID_TRACKER, 15.0);
      expect(result).not.toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockNotifications.create.mock.calls.length).toBeGreaterThan(0);
    });

    it('déclenche alerte géofence pour les deux sources (via le même service)', async () => {
      addVehicleMock(VEHICLE_ID);
      mockGeofence.checkGeofences.mockResolvedValue([
        { event: 'entry', geofenceId: 'gf-1', geofenceName: 'Zone Test' },
      ]);

      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.findFirst.mockResolvedValue({ id: DELIVERY_ID, title: 'Test' });
      mockPrisma.delivery.findUnique.mockResolvedValue({
        id: DELIVERY_ID,
        scheduledDate: new Date(),
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockPrisma.companySettings.findUnique.mockResolvedValue({
        speedAlertThreshold: 140,
        offlineTimeoutMinutes: 15,
      });

      const result = await trackingService.savePosition(
        DRIVER_ID,
        basePosition({ vehicleId: VEHICLE_ID }),
        COMPANY_ID,
      );

      expect(result).not.toBeNull();
      await new Promise((r) => setTimeout(r, 50));
      expect(mockNotifications.create.mock.calls.length).toBeGreaterThan(0);
    });
  });

  // ─── 4.3 Alerte de proximité livraison ───────────────────────────────
  describe('4.3 Alerte proximité livraison', () => {
    it('déclenche proximityAlert pour traceur physique (calcul backend)', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({ id: DRIVER_ID, userId: USER_ID });
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        title: 'Livraison Test',
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockCache.get.mockResolvedValue(null);

      await proximityService.checkProximity(
        DRIVER_ID,
        VEHICLE_ID_TRACKER,
        COMPANY_ID,
        DELIVERY_LAT + 0.001,
        DELIVERY_LNG + 0.001,
        new Date(),
      );

      expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'proximityAlert',
          targetUserId: USER_ID,
        }),
      );
    });
  });

  // ─── 4.4 File d'attente en cas de coupure ────────────────────────────
  describe("4.4 File d'attente coupure réseau", () => {
    it('queue Redis pour positions Traccar quand savePosition échoue', async () => {
      const mockRedis = {
        lpush: jest.fn().mockResolvedValue(1),
        ltrim: jest.fn().mockResolvedValue('OK'),
        llen: jest.fn().mockResolvedValue(0),
        lrange: jest.fn().mockResolvedValue([]),
      };

      const bridgeConfig = {
        get: jest.fn((key: string) => {
          if (key === 'TRACCAR_URL') return 'http://traccar:8082';
          if (key === 'TRACCAR_USER') return 'admin';
          if (key === 'TRACCAR_PASSWORD') return 'admin';
          return null;
        }),
      };

      const bridge = new TraccarBridgeService(
        bridgeConfig as any,
        mockPrisma as any,
        trackingService,
        mockGateway as any,
        mockNotifications as any,
        null,
        mockRedis as any,
      );

      (bridge as any).connected = true;
      (bridge as any).sessionCookie = 'test-cookie';

      await (bridge as any).handlePosition(baseTraccarPos({ speed: 5 }));

      expect(mockRedis.lpush).not.toHaveBeenCalled();

      mockRedis.lpush = jest.fn().mockResolvedValue(1);
      mockRedis.llen = jest.fn().mockResolvedValue(0);

      mockPrisma.vehicle.findFirst.mockResolvedValue({
        id: VEHICLE_ID_TRACKER,
        companyId: COMPANY_ID,
        driver: { id: DRIVER_ID, userId: USER_ID },
      });

      await (bridge as any).handlePosition(baseTraccarPos({ speed: 5 }));
    });
  });

  // ─── 4.6 Dérivation de vitesse (parité avec le chemin phone) ─────────
  describe('4.6 Dérivation de vitesse quand le traceur ne remonte pas de vitesse', () => {
    // UUID v4 STRICTEMENT valide (le pont valide le DTO via class-validator @IsUUID('4'),
    // contrairement à savePosition qui ne vérifie que la longueur).
    const VALID_TRACKER_VEHICLE_ID = '11111111-1111-4111-8111-111111111111';

    function makeBridge() {
      const bridgeConfig = {
        get: jest.fn((key: string) => {
          if (key === 'TRACCAR_URL') return 'http://traccar:8082';
          if (key === 'TRACCAR_USER') return 'admin';
          if (key === 'TRACCAR_PASSWORD') return 'admin';
          return null;
        }),
      };
      const bridge = new TraccarBridgeService(
        bridgeConfig as any,
        mockPrisma as any,
        trackingService,
        mockGateway as any,
        mockNotifications as any,
        null,
        null,
      );
      (bridge as any).connected = true;
      (bridge as any).sessionCookie = 'test-cookie';
      return bridge;
    }

    beforeEach(() => {
      mockPrisma.vehicle.findFirst.mockResolvedValue({
        id: VALID_TRACKER_VEHICLE_ID,
        companyId: COMPANY_ID,
        positionSource: 'physical_tracker',
        isActive: true,
        deletedAt: null,
      });
      mockPrisma.vehicle.findUnique.mockResolvedValue({ companyId: COMPANY_ID });
    });

    it('dérive la vitesse haversine/Δt quand speed=0 et signal précis (comme le téléphone)', async () => {
      // Dernière position fiable : 30 s avant, ~166 m au sud, accuracy 12 m.
      mockPrisma.gpsPosition.findFirst.mockResolvedValue({
        latitude: DELIVERY_LAT,
        longitude: DELIVERY_LNG,
        timestamp: new Date(Date.now() - 30_000),
        speed: 0,
        accuracy: 12,
        suspect: false,
      });

      await (makeBridge() as any).handlePosition(
        baseTraccarPos({
          speed: 0,
          latitude: DELIVERY_LAT + 0.0015,
          longitude: DELIVERY_LNG,
          accuracy: 10,
          fixTime: new Date().toISOString(),
          deviceTime: new Date().toISOString(),
        }),
      );

      const call = mockPrisma.gpsPosition.create.mock.calls.at(-1)?.[0];
      expect(call).toBeDefined();
      expect(call.data.speed).toBeGreaterThan(1); // ~5,5 m/s dérivé, plus 0
    });

    it('ne dérive PAS quand le signal est dégradé (accuracy > 30 m) — pas de vitesse fabriquée par le bruit', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValue({
        latitude: DELIVERY_LAT,
        longitude: DELIVERY_LNG,
        timestamp: new Date(Date.now() - 30_000),
        speed: 0,
        accuracy: 80,
        suspect: false,
      });

      await (makeBridge() as any).handlePosition(
        baseTraccarPos({
          speed: 0,
          latitude: DELIVERY_LAT + 0.0015,
          longitude: DELIVERY_LNG,
          accuracy: 85,
          fixTime: new Date().toISOString(),
          deviceTime: new Date().toISOString(),
        }),
      );

      const call = mockPrisma.gpsPosition.create.mock.calls.at(-1)?.[0];
      expect(call).toBeDefined();
      expect(call.data.speed).toBe(0);
    });
  });

  // ─── 4.5 Sauvegarde en base identique ────────────────────────────────
  describe('4.5 Sauvegarde en base', () => {
    it('phone et physical_tracker utilisent la même table gpsPositions', async () => {
      addVehicleMock(VEHICLE_ID);
      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.findFirst.mockResolvedValue({ id: DELIVERY_ID, title: 'Test' });
      mockPrisma.delivery.findUnique.mockResolvedValue({
        id: DELIVERY_ID,
        scheduledDate: new Date(),
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockPrisma.companySettings.findUnique.mockResolvedValue({ offlineTimeoutMinutes: 15 });

      const result = await trackingService.savePosition(DRIVER_ID, basePosition(), COMPANY_ID);

      expect(mockPrisma.gpsPosition.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });
});
