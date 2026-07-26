import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
  },
  $executeRawUnsafe: jest.fn(),
  $queryRaw: jest.fn(),
  gpsPosition: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
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
};

const mockNotifications = {
  create: jest.fn(),
};

const mockGeofenceService = {
  checkGeofences: jest.fn().mockResolvedValue(null),
};

const mockDeliveryProximityService = {
  checkProximity: jest.fn().mockResolvedValue(undefined),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn().mockResolvedValue(undefined),
};

const mockDataUpdateBus = {
  emit: jest.fn(),
  on: jest.fn(),
};

describe('TrackingService', () => {
  let service: TrackingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TrackingService(
      mockPrisma as unknown as PrismaService,
      mockNotifications as any,
      mockGeofenceService as any,
      mockDeliveryProximityService as any,
      mockCacheService as any,
      mockDataUpdateBus as any,
    );
  });

  it('finds a driver by attached user id', async () => {
    mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });

    await expect(service.findDriverByUserId('user-1')).resolves.toEqual({ id: 'driver-1' });
    expect(mockPrisma.driver.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  describe('verifyDriverAssignment', () => {
    it('allows when assignedDriverId matches', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        assignedDriverId: 'user-1',
        driverId: 'driver-1',
        companyId: 'company-1',
      });

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).resolves.toBeUndefined();
    });

    it('allows when driverId matches via Driver record', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        assignedDriverId: 'other-user',
        driverId: 'driver-1',
        companyId: 'company-1',
      });
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when driver is not assigned', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        assignedDriverId: 'other-user',
        driverId: 'driver-2',
        companyId: 'company-1',
      });
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when delivery does not exist', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce(null);

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('savePosition', () => {
    const dto = {
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 42,
      timestamp: '2026-07-21T10:00:00.000Z',
      deliveryId: 'delivery-1',
      vehicleId: 'vehicle-1',
    };

    const ts = new Date(dto.timestamp);

    it('returns null when timestamp is anterior (out-of-order replay)', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce({
        timestamp: new Date('2026-07-21T10:00:02.000Z'),
      });

      await expect(service.savePosition('driver-1', dto)).resolves.toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('accepts all positions in a 3s-interval sequence (INTERVAL_FAST scenario)', async () => {
      const base = new Date('2026-07-21T10:00:00.000Z');
      const deliveries = ['delivery-1', 'delivery-1', 'delivery-1'];

      for (let i = 0; i < 10; i++) {
        const ts = new Date(base.getTime() + i * 3000);
        mockPrisma.gpsPosition.findFirst
          // isDuplicateByTimestamp: return last saved at (i-1)*3s (or null for i=0)
          .mockResolvedValueOnce(
            i === 0 ? null : { timestamp: new Date(base.getTime() + (i - 1) * 3000) },
          )
          // detectTeleportation: no last position → not teleportation
          .mockResolvedValueOnce(null);
        mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: `gps-3s-${i}`, suspect: false });

        const result = await service.savePosition('driver-1', {
          ...dto,
          deliveryId: deliveries[i],
          timestamp: ts.toISOString(),
        });
        expect(result).not.toBeNull();
        expect(result!.id).toBe(`gps-3s-${i}`);
      }

      expect(mockPrisma.gpsPosition.create).toHaveBeenCalledTimes(10);
    });

    it('rejects only positions within 1s clock skew (not legitimate 3s intervals)', async () => {
      const base = new Date('2026-07-21T10:00:00.000Z');

      // First position at T+0s → accepted
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-skew-0', suspect: false });
      const r0 = await service.savePosition('driver-1', { ...dto, timestamp: base.toISOString() });
      expect(r0).not.toBeNull();

      // Second position at T+0.5s (clock skew, within 1s window) → rejected
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce({ timestamp: base });
      const r1 = await service.savePosition('driver-1', {
        ...dto,
        timestamp: new Date(base.getTime() + 500).toISOString(),
      });
      expect(r1).toBeNull();

      // Third position at T+3s (legitimate movement update) → accepted
      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce({ timestamp: base })
        .mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-skew-3', suspect: false });
      const r2 = await service.savePosition('driver-1', {
        ...dto,
        timestamp: new Date(base.getTime() + 3000).toISOString(),
      });
      expect(r2).not.toBeNull();
    });

    it('stores a new GPS point with teleportation check', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-2', suspect: false });

      await expect(service.savePosition('driver-1', dto)).resolves.toEqual({
        id: 'gps-2',
        suspect: false,
      });
      expect(mockPrisma.gpsPosition.create).toHaveBeenCalledWith({
        data: {
          latitude: -18.8792,
          longitude: 47.5079,
          speed: 42,
          heading: undefined,
          altitude: undefined,
          accuracy: undefined,
          suspect: false,
          location: 'POINT(47.5079 -18.8792)',
          timestamp: ts,
          deliveryId: 'delivery-1',
          vehicleId: 'vehicle-1',
          driverId: 'driver-1',
        },
      });
    });

    it('marks position as suspect on teleportation', async () => {
      const now = new Date('2026-07-21T10:00:00.000Z');
      const fiveSecAgo = new Date(now.getTime() - 5000);

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ latitude: 0, longitude: 0, timestamp: fiveSecAgo });

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-3', suspect: true });

      const result = await service.savePosition('driver-1', {
        ...dto,
        timestamp: now.toISOString(),
        latitude: 1,
        longitude: 1,
      });

      expect(result).toEqual({ id: 'gps-3', suspect: true });
    });

    it('marks suspect when timestamp is non-increasing (cross-delivery desync)', async () => {
      // Previous position on delivery-1 at T+5s
      mockPrisma.gpsPosition.findFirst
        // isDuplicateByTimestamp: no prev for (vehicle-1, delivery-2) → passes
        .mockResolvedValueOnce(null)
        // detectTeleportation: finds last by vehicleId → timestamp 5s AHEAD of new point
        .mockResolvedValueOnce({
          latitude: -18.8792,
          longitude: 47.5079,
          timestamp: new Date('2026-07-21T10:00:05.000Z'),
        });

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-desync', suspect: true });

      const result = await service.savePosition('driver-1', {
        ...dto,
        // Different delivery → dedup doesn't catch it
        deliveryId: 'delivery-2',
        // Timestamp 2s in the past relative to last position on delivery-1
        timestamp: '2026-07-21T10:00:03.000Z',
        latitude: -18.8795,
        longitude: 47.508,
      });

      expect(result).toEqual({ id: 'gps-desync', suspect: true });
    });
  });

  describe('savePosition with alerts', () => {
    const dto = {
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 0.1,
      timestamp: '2026-07-21T10:00:00.000Z',
      deliveryId: 'delivery-1',
      vehicleId: 'vehicle-1',
    };

    it('triggers prolonged stop alert for near-zero speeds (GPS noise)', async () => {
      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce(null) // detectTeleportation lastPos
        .mockResolvedValue({
          // remaining findFirst calls (prolonged stop, offline)
          speed: 0.2,
          timestamp: new Date('2026-07-21T09:54:30.000Z'),
        });

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-stop', suspect: false });

      mockPrisma.companySettings.findUnique.mockResolvedValue({
        prolongedStopMinutes: 5,
        speedAlertThreshold: null,
        offlineTimeoutMinutes: null,
      });

      mockPrisma.gpsPosition.findMany.mockResolvedValue([{ speed: 0.1 }]);

      mockPrisma.delivery.findUnique.mockResolvedValue({
        deliveryLat: -18.8792,
        deliveryLng: 47.5079,
        scheduledDate: new Date('2026-07-22T00:00:00.000Z'),
      });

      const result = await service.savePosition('driver-1', dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(false);
      // Must be at least 1 prolonged_stop alert
      const stopCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'prolonged_stop',
      );
      expect(stopCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT trigger delay alert on isolated momentary slowdown', async () => {
      // Previous 5 positions at normal speed (10 m/s)
      const prevPositions = [
        { speed: 9.8 },
        { speed: 10.2 },
        { speed: 10.1 },
        { speed: 9.9 },
        { speed: 10.0 },
      ];

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce(null); // detectTeleportation

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-avg', suspect: false });

      // generateAlerts
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({});
      // prolonged stop: speed=0.5, NOT < 0.3 → skip
      // delay alert: speed=0.5 > 0 → enters
      // Delivery very close to current pos (~238m). With smoothed average 10 m/s,
      // ETA = 23.8s → on time. With momentary 0.5 m/s (ignored), ETA = 476s → late.
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        deliveryLat: -18.88,
        deliveryLng: 47.51,
        scheduledDate: new Date('2026-07-21T10:31:00.000Z'), // 30s from now, reachable at 10 m/s
      });
      // getAverageSpeed → returns ~10 m/s (not the momentary 0.5)
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(prevPositions);
      // offline timeout
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null);

      const result = await service.savePosition(
        'driver-1',
        {
          ...dto,
          speed: 0.5, // momentary slowdown, normal speed was 10
          timestamp: '2026-07-21T10:30:00.000Z',
        },
        'company-1',
      );
      // Wait for fire-and-forget generateAlerts to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(result).not.toBeNull();
      // getAverageSpeed returned ~10, so ETA = distance/10, not distance/0.5
      // The momentary slowdown did NOT trigger a false delay alert
      const delayCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'delay_alert',
      );
      expect(delayCalls).toHaveLength(0);
    });
  });

  describe('speed alert cooldown (CacheService/Redis)', () => {
    it('respects cooldown: only one alert created for rapid same-vehicle speed events', async () => {
      const dto = {
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 30,
        timestamp: '2026-07-21T10:00:00.000Z',
        deliveryId: 'delivery-1',
        vehicleId: 'vehicle-1',
      };

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce(null) // detectTeleportation
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce(null); // detectTeleportation

      mockPrisma.gpsPosition.create.mockResolvedValue({ id: 'gps-cooldown', suspect: false });

      mockPrisma.companySettings.findUnique.mockResolvedValue({
        speedAlertThreshold: 50,
        prolongedStopMinutes: null,
        offlineTimeoutMinutes: null,
      });

      mockPrisma.delivery.findUnique.mockResolvedValue({
        deliveryLat: -18.88,
        deliveryLng: 47.51,
        scheduledDate: new Date('2026-07-22T00:00:00.000Z'),
      });

      mockPrisma.gpsPosition.findMany.mockResolvedValue([{ speed: 30 }]);

      // First save: no cooldown → cache.get returns null → alert created
      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition('driver-1', dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50)); // wait for fire-and-forget generateAlerts

      expect(mockCacheService.set).toHaveBeenCalledWith('speed_alert:vehicle-1', true, 300);
      expect(mockCacheService.get).toHaveBeenCalledWith('speed_alert:vehicle-1');

      // Second save: cooldown active → cache.get returns true → no alert
      mockCacheService.get.mockResolvedValueOnce(true);
      await service.savePosition('driver-1', dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      const speedAlertCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'speed_alert',
      );
      expect(speedAlertCalls).toHaveLength(1);
    });

    it('creates new alert after cooldown expires', async () => {
      const dto = {
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 30,
        timestamp: '2026-07-21T10:00:00.000Z',
        deliveryId: 'delivery-1',
        vehicleId: 'vehicle-2',
      };

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      mockPrisma.gpsPosition.create.mockResolvedValue({ id: 'gps-cooldown-2', suspect: false });

      mockPrisma.companySettings.findUnique.mockResolvedValue({
        speedAlertThreshold: 50,
        prolongedStopMinutes: null,
        offlineTimeoutMinutes: null,
      });

      mockPrisma.delivery.findUnique.mockResolvedValue({
        deliveryLat: -18.88,
        deliveryLng: 47.51,
        scheduledDate: new Date('2026-07-22T00:00:00.000Z'),
      });

      mockPrisma.gpsPosition.findMany.mockResolvedValue([{ speed: 30 }]);

      // First save: no cooldown → alert
      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition('driver-1', dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      // Second save: cooldown expired → cache.get returns null → new alert
      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition('driver-1', dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      const speedAlertCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'speed_alert',
      );
      expect(speedAlertCalls).toHaveLength(2);
    });
  });

  describe('saveBatch', () => {
    it('saves positions and skips those where driver is not assigned', async () => {
      const positions = [
        {
          latitude: 1,
          longitude: 2,
          timestamp: '2026-07-21T10:00:00.000Z',
          deliveryId: 'delivery-1',
          vehicleId: 'vehicle-1',
        },
        {
          latitude: 3,
          longitude: 4,
          timestamp: '2026-07-21T10:00:05.000Z',
          deliveryId: 'delivery-2',
          vehicleId: 'vehicle-2',
        },
      ];

      mockPrisma.delivery.findUnique
        .mockResolvedValueOnce({
          assignedDriverId: 'user-1',
          driverId: null,
          companyId: 'company-1',
        })
        .mockResolvedValueOnce(null);

      mockPrisma.gpsPosition.findFirst.mockResolvedValue(null);

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-1', suspect: false });

      const saved = await service.saveBatch('user-1', 'driver-1', positions);

      expect(saved).toHaveLength(1);
      expect(mockPrisma.gpsPosition.create).toHaveBeenCalledTimes(1);
    });
  });

  it('lists positions for a delivery in company scope', async () => {
    mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
      {
        id: 'gps-1',
        latitude: 0,
        longitude: 0,
        speed: null,
        heading: null,
        altitude: null,
        accuracy: null,
        suspect: false,
        timestamp: new Date(),
        driverId: null,
      },
    ]);
    mockPrisma.gpsPosition.count.mockResolvedValueOnce(1);

    const result = await service.getPositionsByDelivery('delivery-1', 'company-1');
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(mockPrisma.gpsPosition.findMany).toHaveBeenCalled();
  });

  describe('getDeliveryInfo', () => {
    it('returns public route data for a delivery', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'delivery-1',
        publicTrackingRevokedAt: null,
      });

      await expect(service.getDeliveryInfo('delivery-1', 'company-1')).resolves.toEqual({
        id: 'delivery-1',
        publicTrackingRevokedAt: null,
      });
    });

    it('throws when delivery does not belong to the company', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);

      await expect(service.getDeliveryInfo('delivery-1', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('calculateDistance', () => {
    it('returns zero for fewer than two positions', async () => {
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([{ latitude: 0, longitude: 0 }]);

      await expect(service.calculateDistance('delivery-1', 'company-1')).resolves.toEqual({
        meters: 0,
        kilometers: 0,
      });
    });

    it('calculates haversine distance across tracked positions', async () => {
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ]);

      const result = await service.calculateDistance('delivery-1', 'company-1');

      expect(result.meters).toBeGreaterThan(111000);
      expect(result.meters).toBeLessThan(112000);
      expect(result.kilometers).toBeCloseTo(111.19, 1);
    });
  });

  describe('getTripReport', () => {
    it('reports more positions and distance when dedup does not drop 3s-interval points', async () => {
      // Simulate 20 positions along a line at 3s intervals (60s of movement)
      const positions: any[] = [];
      for (let i = 0; i < 20; i++) {
        positions.push({
          latitude: 48.8566 + i * 0.0005,
          longitude: 2.3522 + i * 0.0005,
          speed: 10,
          heading: 45,
          altitude: null,
          accuracy: 10,
          suspect: false,
          timestamp: new Date(Date.parse('2026-07-21T10:00:00.000Z') + i * 3000),
          driverId: 'driver-1',
        });
      }

      mockPrisma.gpsPosition.findMany.mockResolvedValue(positions);
      mockPrisma.delivery.findFirst.mockResolvedValue({
        id: 'delivery-1',
        title: 'Test',
        status: 'in_progress',
        pickupAddress: 'A',
        deliveryAddress: 'B',
        pickupLat: null,
        pickupLng: null,
        deliveryLat: null,
        deliveryLng: null,
        scheduledDate: new Date(),
        publicTrackingRevokedAt: null,
      });

      const report = await service.getTripReport('delivery-1', 'company-1');

      expect(report.positionCount).toBe(20);
      // 20 points at 3s → 57s duration
      expect(report.totalDurationSec).toBe(57);
      // Haversine distance across 20 points should be > 0
      expect(report.totalDistance.meters).toBeGreaterThan(1000);

      // Now simulate the OLD behavior: only ~1/2 of positions were saved (1 per 6s)
      const sparsePositions = positions.filter((_: any, i: number) => i % 2 === 0);
      mockPrisma.gpsPosition.findMany.mockResolvedValue(sparsePositions);

      const sparseReport = await service.getTripReport('delivery-1', 'company-1');

      // The corrected (dense) report must show more distance than the sparse (old-behavior) one
      expect(report.totalDistance.meters).toBeGreaterThan(sparseReport.totalDistance.meters);
      expect(report.positionCount).toBeGreaterThan(sparseReport.positionCount);
    });
  });

  describe('revokePublicToken', () => {
    it('sets publicTrackingRevokedAt on the delivery', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({ id: 'delivery-1' });
      mockPrisma.delivery.update.mockResolvedValueOnce({ id: 'delivery-1' });

      await expect(service.revokePublicToken('delivery-1', 'company-1')).resolves.toBeUndefined();
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: { publicTrackingRevokedAt: expect.any(Date) },
      });
    });

    it('throws when delivery not found', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);

      await expect(service.revokePublicToken('delivery-1', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLivePositions', () => {
    it('returns live positions scoped by companyId', async () => {
      mockPrisma.$queryRaw = jest.fn().mockResolvedValue([
        {
          driver_id: 'driver-1',
          driver_first_name: 'Driver',
          driver_last_name: 'One',
          latitude: -18.8792,
          longitude: 47.5079,
          speed: 8.33,
          heading: 135,
          accuracy: 10,
          timestamp: new Date(),
          vehicle_id: 'vehicle-1',
          delivery_id: 'delivery-1',
          minutes_ago: 0.5,
        },
      ]);

      const result = await service.getLivePositions('company-a');

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0].driverId).toBe('driver-1');
      expect(result[0].driverName).toBe('Driver One');
      expect(result[0].minutesAgo).toBe(0.5);
    });

    it('excludes soft-deleted and inactive vehicles', async () => {
      mockPrisma.$queryRaw = jest.fn().mockResolvedValue([]);

      const result = await service.getLivePositions('company-empty');

      expect(result).toHaveLength(0);
    });
  });

  describe('archivePositionsBefore — multi-tenant scope', () => {
    it('should filter by companyId using vehicles join', async () => {
      mockPrisma.$executeRawUnsafe = jest.fn().mockResolvedValue(5);

      await service.archivePositionsBefore(new Date('2026-01-01'), 'company-a');

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const sql: string = mockPrisma.$executeRawUnsafe.mock.calls[0][0];
      const params = mockPrisma.$executeRawUnsafe.mock.calls[0].slice(1);

      expect(sql).toContain('vehicles.company_id = $2::uuid');
      expect(params[1]).toBe('company-a');
    });

    it('should not affect positions from other companies', async () => {
      mockPrisma.$executeRawUnsafe = jest.fn().mockResolvedValue(0);

      const result = await service.archivePositionsBefore(new Date('2026-01-01'), 'company-b');

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const params = mockPrisma.$executeRawUnsafe.mock.calls[0].slice(1);
      expect(params[1]).toBe('company-b');
      expect(result).toBe(0);
    });
  });
});
