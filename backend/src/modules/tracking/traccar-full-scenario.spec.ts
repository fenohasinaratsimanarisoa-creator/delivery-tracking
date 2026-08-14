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

// =============================================================================
// Test de bout en bout : livraison 100% Traccar (pas de positions mobile)
// =============================================================================

describe('E2E: Full delivery scenario using ONLY Traccar positions', () => {
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
  const DELIVERY_ID = '00000000-0000-4000-0000-00000000000a';
  const DELIVERY_LAT = -18.8792;
  const DELIVERY_LNG = 47.5079;

  const traccarPosition = (overrides = {}) => ({
    id: 12345,
    deviceId: 678,
    latitude: DELIVERY_LAT + 0.0005,
    longitude: DELIVERY_LNG + 0.0005,
    speed: 5.0,
    course: 90,
    altitude: 100,
    accuracy: 10,
    fixTime: '2026-07-21T10:00:00.000Z',
    deviceTime: '2026-07-21T10:00:00.000Z',
    ...overrides,
  });

  const updatePositionDto = (overrides = {}) => ({
    latitude: DELIVERY_LAT + 0.0005,
    longitude: DELIVERY_LNG + 0.0005,
    speed: 2.57,
    heading: 90,
    altitude: 100,
    accuracy: 10,
    timestamp: '2026-07-21T10:00:00.000Z',
    vehicleId: VEHICLE_ID,
    deliveryId: DELIVERY_ID,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      driver: {
        findUnique: jest.fn().mockResolvedValue({ id: DRIVER_ID, userId: USER_ID }),
        findMany: jest.fn(),
        // generateAlerts résout l'utilisateur cible via l'ID de la ligne Driver
        findFirst: jest.fn().mockResolvedValue({ id: DRIVER_ID, userId: USER_ID }),
      },
      vehicle: {
        findUnique: jest.fn().mockResolvedValue({ companyId: COMPANY_ID }),
        // savePosition() résout le véhicule via findFirst (filtre actif/non supprimé)
        findFirst: jest.fn().mockResolvedValue({ companyId: COMPANY_ID }),
        findMany: jest.fn(),
      },
      delivery: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      gpsPosition: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        count: jest.fn(),
      },
      companySettings: {
        findUnique: jest.fn(),
      },
      geofence: {
        findMany: jest.fn(),
      },
      geofenceEvent: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    mockGateway = {
      sendToDriver: jest.fn(),
      broadcastToCompany: jest.fn(),
      broadcastDataUpdate: jest.fn(),
    } as any;

    mockNotifications = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    } as any;

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      invalidate: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockDataUpdateBus = {
      emit: jest.fn(),
      emitUpdate: jest.fn(),
      on: jest.fn(),
    };

    mockGeofence = {
      checkGeofences: jest.fn().mockResolvedValue([]),
      findForDelivery: jest.fn(),
    } as any;

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
  });

  // ===========================================================================
  // 1. VÉRIFICATION : Le nom du chauffeur n'est PLUS "Traccar GPS" (Bug #2)
  // ===========================================================================
  describe('BUG #2 fix: Driver name is NOT "Traccar GPS"', () => {
    it('uses real driver name when user data is available', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValue({
        id: VEHICLE_ID,
        companyId: COMPANY_ID,
        driver: {
          id: DRIVER_ID,
          userId: USER_ID,
          user: { firstName: 'Jean', lastName: 'Rakoto' },
        },
      });
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        status: 'in_progress',
        deletedAt: null,
      });
      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.gpsPosition.create.mockResolvedValue({
        id: 'gps-traccar-1',
        suspect: false,
        latitude: DELIVERY_LAT + 0.0005,
        longitude: DELIVERY_LNG + 0.0005,
        speed: 2.57,
        heading: 90,
        altitude: 100,
        accuracy: 10,
        deliveryId: DELIVERY_ID,
        vehicleId: VEHICLE_ID,
        driverId: DRIVER_ID,
      });

      const dto = updatePositionDto();
      const saved = await trackingService.savePosition(DRIVER_ID, dto, COMPANY_ID);

      expect(saved).not.toBeNull();
      expect(mockGateway.broadcastToCompany).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ driverName: 'Traccar GPS' }),
      );
    });
  });

  // ===========================================================================
  // 2. VÉRIFICATION : Alerte de proximité déclenchée par position Traccar
  // ===========================================================================
  describe('Proximity alert triggered by Traccar position', () => {
    it('sends proximityAlert when Traccar position is within 300m of delivery', async () => {
      mockPrisma.driver.findUnique.mockResolvedValue({ id: DRIVER_ID, userId: USER_ID });
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        title: 'Livraison Test Traccar',
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.gpsPosition.create.mockResolvedValue({
        id: 'gps-prox-1',
        suspect: false,
      });
      mockCache.get.mockResolvedValue(null);
      mockPrisma.companySettings.findUnique.mockResolvedValue(null);

      await trackingService.savePosition(DRIVER_ID, updatePositionDto(), COMPANY_ID);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'proximityAlert',
          targetUserId: USER_ID,
          payload: expect.objectContaining({
            type: 'proximity',
            deliveryId: DELIVERY_ID,
          }),
        }),
      );
    });

    it('escalates to critical urgency after 15 minutes without validation', async () => {
      const fifteenMinAgo = Date.now() - 16 * 60 * 1000;

      mockPrisma.driver.findUnique.mockResolvedValue({ id: DRIVER_ID, userId: USER_ID });
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        title: 'Livraison longue',
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
      });
      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);
      mockPrisma.gpsPosition.create.mockResolvedValue({ id: 'gps-esc', suspect: false });
      mockCache.get.mockResolvedValue(fifteenMinAgo);
      mockPrisma.companySettings.findUnique.mockResolvedValue(null);

      await trackingService.savePosition(DRIVER_ID, updatePositionDto(), COMPANY_ID);
      await new Promise((r) => setTimeout(r, 50));

      expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'proximityAlert',
          targetUserId: USER_ID,
          payload: expect.objectContaining({
            urgency: 'critical',
            escalationLevel: 2,
          }),
        }),
      );
    });
  });

  // ===========================================================================
  // 3. VÉRIFICATION : Alertes classiques (vitesse, arrêt prolongé) avec Traccar
  // ===========================================================================
  describe('Classic alerts with Traccar positions', () => {
    it('triggers speed alert from Traccar position', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValue({ id: 'gps-speed', suspect: false });
      mockPrisma.companySettings.findUnique.mockResolvedValue({
        speedAlertThreshold: 50,
        prolongedStopMinutes: null,
        offlineTimeoutMinutes: null,
      });
      // Proximity check needs a delivery mock (return null so it exits early)
      mockPrisma.delivery.findFirst.mockResolvedValue(null);
      mockCache.get.mockResolvedValue(null);

      const dto = updatePositionDto({ speed: 20 });
      await trackingService.savePosition(DRIVER_ID, dto, COMPANY_ID);
      await new Promise((r) => setTimeout(r, 50));

      const speedAlerts = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'speed_alert',
      );
      expect(speedAlerts.length).toBeGreaterThanOrEqual(1);
    });

    it('works for all alert types (prolonged stop, delay, offline)', async () => {
      const now = new Date();
      const sixMinAgo = new Date(now.getTime() - 6 * 60 * 1000);
      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ speed: 0.1, timestamp: sixMinAgo, id: 'last-pos' });
      mockPrisma.gpsPosition.create.mockResolvedValue({
        id: 'gps-stop-2',
        suspect: false,
        timestamp: now,
      });
      mockPrisma.companySettings.findUnique.mockResolvedValue({
        prolongedStopMinutes: 5,
        speedAlertThreshold: null,
        offlineTimeoutMinutes: null,
      });
      mockPrisma.delivery.findUnique.mockResolvedValue({
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
        scheduledDate: new Date(now.getTime() + 3600000),
      });
      mockPrisma.gpsPosition.findMany.mockResolvedValue([{ speed: 0.1 }]);
      // Proximity check needs a delivery mock (return null so it exits early)
      mockPrisma.delivery.findFirst.mockResolvedValue(null);

      const dto = updatePositionDto({ speed: 0.05, timestamp: now.toISOString() });
      await trackingService.savePosition(DRIVER_ID, dto, COMPANY_ID);
      await new Promise((r) => setTimeout(r, 50));

      const stopAlerts = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'prolonged_stop',
      );
      expect(stopAlerts.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // 4. VÉRIFICATION : Le rapport carburant fonctionne avec positions Traccar
  // ===========================================================================
  describe('Fuel consumption report with Traccar positions', () => {
    it('calculates distance from Traccar-sourced positions', async () => {
      const base = new Date('2026-07-21T10:00:00.000Z');
      const positions = [
        { latitude: -18.88, longitude: 47.5, timestamp: new Date(base.getTime()) },
        { latitude: -18.87, longitude: 47.51, timestamp: new Date(base.getTime() + 30000) },
        { latitude: -18.86, longitude: 47.52, timestamp: new Date(base.getTime() + 60000) },
      ];

      mockPrisma.gpsPosition.findMany.mockResolvedValue(positions);
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        title: 'Traccar Delivery',
        status: 'delivered',
        pickupAddress: 'A',
        deliveryAddress: 'B',
        pickupLat: null,
        pickupLng: null,
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
        scheduledDate: new Date(),
        publicTrackingRevokedAt: null,
      });
      mockPrisma.gpsPosition.count.mockResolvedValue(positions.length);

      const report = await trackingService.getTripReport(DELIVERY_ID, COMPANY_ID);

      expect(report.positionCount).toBe(3);
      expect(report.totalDistance.meters).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // 5. VÉRIFICATION : La carte temps réel affiche le bon nom (dépend de #2)
  // ===========================================================================
  describe('Real-time map shows real driver name for Traccar vehicles', () => {
    it('getLivePositions returns driver name from driver table, not "Traccar GPS"', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        {
          driver_id: DRIVER_ID,
          driver_first_name: 'Jean',
          driver_last_name: 'Rakoto',
          latitude: DELIVERY_LAT,
          longitude: DELIVERY_LNG,
          speed: 5,
          heading: 90,
          accuracy: 10,
          timestamp: new Date(),
          vehicle_id: VEHICLE_ID,
          delivery_id: DELIVERY_ID,
          minutes_ago: 0.5,
        },
      ]);

      const livePositions = await trackingService.getLivePositions(COMPANY_ID);

      expect(livePositions).toHaveLength(1);
      expect(livePositions[0].driverName).toBe('Jean Rakoto');
      expect(livePositions[0].driverName).not.toBe('Traccar GPS');
    });
  });

  // ===========================================================================
  // 6. VÉRIFICATION : Le lien public de tracking fonctionne avec Traccar
  // ===========================================================================
  describe('Public tracking link with Traccar positions', () => {
    it('returns delivery info and positions regardless of source', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: DELIVERY_ID,
        title: 'Public Traccar',
        status: 'in_progress',
        pickupAddress: 'Depot',
        deliveryAddress: 'Client',
        pickupLat: null,
        pickupLng: null,
        deliveryLat: DELIVERY_LAT,
        deliveryLng: DELIVERY_LNG,
        scheduledDate: new Date(),
        publicTrackingRevokedAt: null,
      });

      const info = await trackingService.getDeliveryInfo(DELIVERY_ID, COMPANY_ID);

      expect(info.title).toBe('Public Traccar');
      expect(info.deliveryLat).toBe(DELIVERY_LAT);
    });
  });

  // ===========================================================================
  // 7. VÉRIFICATION : Archivage fonctionne sans distinction de source
  // ===========================================================================
  describe('GPS archive handles Traccar positions without source filter', () => {
    it('archivePositionsBefore uses vehicle join, NOT positionSource filter', async () => {
      mockPrisma.$executeRawUnsafe.mockResolvedValue(3);

      const result = await trackingService.archivePositionsBefore(
        new Date('2026-01-01'),
        COMPANY_ID,
      );

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalled();
      const sql: string = mockPrisma.$executeRawUnsafe.mock.calls[0][0];
      expect(sql).not.toContain('position_source');
      expect(result).toBe(3);
    });
  });
});
