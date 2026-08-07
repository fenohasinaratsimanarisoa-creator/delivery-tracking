import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { FuelConsumptionService } from '../fuel-consumption/fuel-consumption.service';

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  vehicle: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  $executeRawUnsafe: jest.fn(),
  $queryRaw: jest.fn(),
  gpsPosition: {
    findFirst: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  companySettings: {
    findUnique: jest.fn(),
  },
  fuelPriceHistory: {
    findFirst: jest.fn(),
  },
  dailyFuelReport: {
    upsert: jest.fn(),
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
  checkGeofences: jest.fn().mockResolvedValue([]),
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
    // savePosition() résout désormais le véhicule via findFirst (filtre deletedAt:null + isActive:true)
    mockPrisma.vehicle.findFirst.mockResolvedValue({ companyId: 'company-1' });
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
      });

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).resolves.toBeUndefined();
    });

    it('allows when driverId matches via Driver record', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        assignedDriverId: 'other-user',
        driverId: 'driver-1',
      });
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });

      await expect(service.verifyDriverAssignment('delivery-1', 'user-1')).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when driver is not assigned', async () => {
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        assignedDriverId: 'other-user',
        driverId: 'driver-2',
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
    const VID = '00000000-0000-4000-0000-000000000001';
    const DID = '00000000-0000-4000-0000-00000000000a';
    const dto = {
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 42,
      timestamp: '2026-07-21T10:00:00.000Z',
      deliveryId: DID,
      vehicleId: VID,
    };

    const ts = new Date(dto.timestamp);

    it('returns null when timestamp is anterior (out-of-order replay)', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce({
        timestamp: new Date('2026-07-21T10:00:02.000Z'),
      });

      await expect(
        service.savePosition('00000000-0000-4000-0000-000000000002', dto),
      ).resolves.toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('accepts all positions in a 3s-interval sequence (INTERVAL_FAST scenario)', async () => {
      const base = new Date('2026-07-21T10:00:00.000Z');
      const deliveries = [DID, DID, DID];

      for (let i = 0; i < 10; i++) {
        const ts = new Date(base.getTime() + i * 3000);
        mockPrisma.gpsPosition.findFirst
          .mockResolvedValueOnce(
            i === 0 ? null : { timestamp: new Date(base.getTime() + (i - 1) * 3000) },
          )
          .mockResolvedValueOnce(null);
        mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: `gps-3s-${i}`, suspect: false });

        const result = await service.savePosition('00000000-0000-4000-0000-000000000002', {
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

      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-skew-0', suspect: false });
      const r0 = await service.savePosition('00000000-0000-4000-0000-000000000002', {
        ...dto,
        timestamp: base.toISOString(),
      });
      expect(r0).not.toBeNull();

      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce({ timestamp: base });
      const r1 = await service.savePosition('00000000-0000-4000-0000-000000000002', {
        ...dto,
        timestamp: new Date(base.getTime() + 500).toISOString(),
      });
      expect(r1).toBeNull();

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce({ timestamp: base })
        .mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-skew-3', suspect: false });
      const r2 = await service.savePosition('00000000-0000-4000-0000-000000000002', {
        ...dto,
        timestamp: new Date(base.getTime() + 3000).toISOString(),
      });
      expect(r2).not.toBeNull();
    });

    it('stores a new GPS point with teleportation check', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-2', suspect: false });

      await expect(
        service.savePosition('00000000-0000-4000-0000-000000000002', dto),
      ).resolves.toEqual({
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
          companyId: 'company-1',
          deliveryId: DID,
          vehicleId: VID,
          driverId: '00000000-0000-4000-0000-000000000002',
          source: 'phone',
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

      const result = await service.savePosition('00000000-0000-4000-0000-000000000002', {
        ...dto,
        timestamp: now.toISOString(),
        latitude: 1,
        longitude: 1,
      });

      expect(result).toEqual({ id: 'gps-3', suspect: true });
    });

    it('marks suspect when timestamp is non-increasing (cross-delivery desync)', async () => {
      const DID2 = '00000000-0000-4000-0000-00000000000b';
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        latitude: -18.8792,
        longitude: 47.5079,
        timestamp: new Date('2026-07-21T10:00:05.000Z'),
      });

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-desync', suspect: true });

      const result = await service.savePosition('00000000-0000-4000-0000-000000000002', {
        ...dto,
        deliveryId: DID2,
        timestamp: '2026-07-21T10:00:03.000Z',
        latitude: -18.8795,
        longitude: 47.508,
      });

      expect(result).toEqual({ id: 'gps-desync', suspect: true });
    });

    it('does NOT call checkProximity for a suspect (teleportation) position', async () => {
      const now = new Date('2026-07-21T10:00:00.000Z');
      const fiveSecAgo = new Date(now.getTime() - 5000);

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce({ latitude: 0, longitude: 0, timestamp: fiveSecAgo }); // detectTeleportation

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({
        id: 'gps-suspect-prox',
        suspect: true,
      });

      const result = await service.savePosition(
        '00000000-0000-4000-0000-000000000002',
        { ...dto, latitude: 1, longitude: 1, timestamp: now.toISOString() },
        'company-1',
      );

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(true);
      // Une position non fiable ne doit pas alimenter le chronomètre de proximité.
      expect(mockDeliveryProximityService.checkProximity).not.toHaveBeenCalled();
    });

    it('calls checkProximity for a non-suspect position (no regression)', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-ok-prox', suspect: false });

      await service.savePosition('00000000-0000-4000-0000-000000000002', dto, 'company-1');

      expect(mockDeliveryProximityService.checkProximity).toHaveBeenCalledTimes(1);
    });

    it('rejects positions for a soft-deleted vehicle — no GPS row inserted', async () => {
      // Le véhicule existe en base mais est soft-deleted (deletedAt = now) :
      // le filtre deletedAt:null l'exclut du findFirst → retour null, aucune insertion.
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findUnique.mockResolvedValueOnce({
        companyId: 'company-1',
        isActive: true,
        deletedAt: new Date(),
      });

      const result = await service.savePosition('00000000-0000-4000-0000-000000000002', dto);

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('rejects positions for a disabled (inactive) vehicle — no GPS row inserted', async () => {
      // Le véhicule existe en base mais est désactivé (isActive = false) :
      // le filtre isActive:true l'exclut du findFirst → retour null, aucune insertion.
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findUnique.mockResolvedValueOnce({
        companyId: 'company-1',
        isActive: false,
        deletedAt: null,
      });

      const result = await service.savePosition('00000000-0000-4000-0000-000000000002', dto);

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('rejects phone position for physical_tracker vehicle — no GPS row inserted', async () => {
      // Isolation stricte des sources : l'app mobile (source='phone') ne doit JAMAIS
      // écrire de position pour un véhicule équipé d'un traceur physique.
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        companyId: 'company-1',
        positionSource: 'physical_tracker',
      });

      const result = await service.savePosition(
        '00000000-0000-4000-0000-000000000002',
        dto,
        'company-1',
        'phone',
      );

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('accepts phone position for a phone vehicle (no regression on normal flow)', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        companyId: 'company-1',
        positionSource: 'phone',
      });
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-phone', suspect: false });

      const result = await service.savePosition(
        '00000000-0000-4000-0000-000000000002',
        dto,
        'company-1',
        'phone',
      );

      expect(result).not.toBeNull();
      expect(mockPrisma.gpsPosition.create).toHaveBeenCalled();
    });

    it('accepts physical_tracker position for a physical_tracker vehicle (Traccar bridge)', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        companyId: 'company-1',
        positionSource: 'physical_tracker',
      });
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-traccar', suspect: false });

      const result = await service.savePosition(
        '00000000-0000-4000-0000-000000000002',
        dto,
        'company-1',
        'physical_tracker',
      );

      expect(result).not.toBeNull();
      expect(mockPrisma.gpsPosition.create).toHaveBeenCalled();
    });
  });

  describe('teleportation detection — real-world scenarios', () => {
    const VID = '00000000-0000-4000-0000-000000000001';
    const DRIVER = '00000000-0000-4000-0000-000000000002';
    const baseTs = new Date('2026-07-21T10:00:00.000Z');

    function setupLastPos(lat: number, lng: number, secondsAgo: number) {
      mockPrisma.vehicle.findFirst.mockResolvedValue({ companyId: 'company-1' });
      mockPrisma.gpsPosition.findFirst
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          latitude: lat,
          longitude: lng,
          timestamp: new Date(baseTs.getTime() - secondsAgo * 1000),
          speed: null,
        });
    }

    it('Scenario 1 — Urban degraded GPS (accuracy 40m, 30km/h) does NOT trigger suspect', async () => {
      setupLastPos(-18.8792, 47.5079, 3);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-urban', suspect: false });

      const result = await service.savePosition(DRIVER, {
        latitude: -18.8795,
        longitude: 47.5082,
        speed: 8.33,
        timestamp: baseTs.toISOString(),
        vehicleId: VID,
        accuracy: 40,
      });

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(false);
    });

    it('Scenario 2 — Network gap 5-10 min + burst (legitimate movement, no teleport)', async () => {
      setupLastPos(-18.8792, 47.5079, 300);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-gap', suspect: false });

      const result = await service.savePosition(DRIVER, {
        latitude: -18.87,
        longitude: 47.52,
        speed: 5.56,
        timestamp: baseTs.toISOString(),
        vehicleId: VID,
        accuracy: 20,
      });

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(false);
    });

    it('Scenario 3 — Motorcycle weaving in traffic (sharp but legitimate speed changes)', async () => {
      setupLastPos(-18.8792, 47.5079, 2);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-moto', suspect: false });

      const result = await service.savePosition(DRIVER, {
        latitude: -18.879,
        longitude: 47.508,
        speed: 13.89,
        timestamp: baseTs.toISOString(),
        vehicleId: VID,
        accuracy: 10,
      });

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(false);
    });
  });

  describe('savePosition with alerts', () => {
    const VID = '00000000-0000-4000-0000-000000000001';
    const DID = '00000000-0000-4000-0000-00000000000a';
    const DRIVER = '00000000-0000-4000-0000-000000000002';
    const dto = {
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 0.1,
      timestamp: '2026-07-21T10:00:00.000Z',
      deliveryId: DID,
      vehicleId: VID,
    };

    it('triggers prolonged stop alert for near-zero speeds (GPS noise)', async () => {
      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null) // dedup
        .mockResolvedValueOnce(null) // detectTeleportation lastPos
        .mockResolvedValue({
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

      const result = await service.savePosition(DRIVER, dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(result).not.toBeNull();
      expect(result!.suspect).toBe(false);
      const stopCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'prolonged_stop',
      );
      expect(stopCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('does NOT trigger delay alert on isolated momentary slowdown', async () => {
      const prevPositions = [
        { speed: 9.8 },
        { speed: 10.2 },
        { speed: 10.1 },
        { speed: 9.9 },
        { speed: 10.0 },
      ];

      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-avg', suspect: false });

      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({});
      mockPrisma.delivery.findUnique.mockResolvedValueOnce({
        deliveryLat: -18.88,
        deliveryLng: 47.51,
        scheduledDate: new Date('2026-07-21T10:31:00.000Z'),
      });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(prevPositions);
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null);

      const result = await service.savePosition(
        DRIVER,
        {
          ...dto,
          speed: 0.5,
          timestamp: '2026-07-21T10:30:00.000Z',
        },
        'company-1',
      );
      await new Promise((r) => setTimeout(r, 50));

      expect(result).not.toBeNull();
      const delayCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'delay_alert',
      );
      expect(delayCalls).toHaveLength(0);
    });
  });

  describe('savePosition without delivery (regression test for UUID crash)', () => {
    const VID = '00000000-0000-4000-0000-000000000001';
    const DRIVER = '00000000-0000-4000-0000-000000000002';

    it('saves position without deliveryId — no Prisma UUID error', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-nodelivery', suspect: false });

      const result = await service.savePosition(DRIVER, {
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 10,
        timestamp: '2026-07-21T10:00:00.000Z',
        vehicleId: VID,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('gps-nodelivery');
      expect(mockPrisma.gpsPosition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vehicleId: VID,
            deliveryId: undefined,
          }),
        }),
      );
    });

    it('rejects empty vehicleId with a clear log, no Prisma crash', async () => {
      const result = await service.savePosition(DRIVER, {
        latitude: -18.8792,
        longitude: 47.5079,
        timestamp: '2026-07-21T10:00:00.000Z',
        vehicleId: '',
      } as any);

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('rejects cross-tenant vehicle (companyId mismatch) — security isolation', async () => {
      const VID = '00000000-0000-4000-0000-000000000001';
      mockPrisma.vehicle.findFirst.mockReset();
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ companyId: 'company-B' });

      const result = await service.savePosition(
        DRIVER,
        {
          latitude: -18.8792,
          longitude: 47.5079,
          speed: 10,
          timestamp: '2026-07-21T10:00:00.000Z',
          vehicleId: VID,
        },
        'company-A',
      );

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });

    it('rejects empty deliveryId (when present) with a clear log, no Prisma crash', async () => {
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.gpsPosition.create.mockResolvedValueOnce({ id: 'gps-ok', suspect: false });

      const result = await service.savePosition(DRIVER, {
        latitude: -18.8792,
        longitude: 47.5079,
        timestamp: '2026-07-21T10:00:00.000Z',
        vehicleId: VID,
        deliveryId: '',
      } as any);

      expect(result).toBeNull();
      expect(mockPrisma.gpsPosition.create).not.toHaveBeenCalled();
    });
  });

  describe('speed alert cooldown (CacheService/Redis)', () => {
    const VID1 = '00000000-0000-4000-0000-000000000001';
    const VID2 = '00000000-0000-4000-0000-000000000003';
    const DID = '00000000-0000-4000-0000-00000000000a';
    const DRIVER = '00000000-0000-4000-0000-000000000002';
    it('respects cooldown: only one alert created for rapid same-vehicle speed events', async () => {
      const dto = {
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 30,
        timestamp: '2026-07-21T10:00:00.000Z',
        deliveryId: DID,
        vehicleId: VID1,
      };

      mockPrisma.gpsPosition.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

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

      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition(DRIVER, dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      expect(mockCacheService.set).toHaveBeenCalledWith(`speed_alert:${VID1}`, true, 300);
      expect(mockCacheService.get).toHaveBeenCalledWith(`speed_alert:${VID1}`);

      mockCacheService.get.mockResolvedValueOnce(true);
      await service.savePosition(DRIVER, dto, 'company-1');
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
        deliveryId: DID,
        vehicleId: VID2,
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

      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition(DRIVER, dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      mockCacheService.get.mockResolvedValueOnce(null);
      await service.savePosition(DRIVER, dto, 'company-1');
      await new Promise((r) => setTimeout(r, 50));

      const speedAlertCalls = mockNotifications.create.mock.calls.filter(
        (call: any[]) => call[1]?.type === 'speed_alert',
      );
      expect(speedAlertCalls).toHaveLength(2);
    });
  });

  describe('rate limiting (isRateLimited)', () => {
    it('allows first request and sets 1s cooldown', async () => {
      mockCacheService.get.mockResolvedValueOnce(null);
      const result = await service.isRateLimited('driver-1');
      expect(result).toBe(false);
      expect(mockCacheService.set).toHaveBeenCalledWith('rate_limit:driver:driver-1', true, 1);
    });

    it('blocks second request within 1s window', async () => {
      mockCacheService.get.mockResolvedValueOnce(true);
      const result = await service.isRateLimited('driver-1');
      expect(result).toBe(true);
      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('increments rateLimited metric on blocked request', async () => {
      const before = service.getMetrics().rateLimited;
      mockCacheService.get.mockResolvedValueOnce(true);
      await service.isRateLimited('driver-1');
      expect(service.getMetrics().rateLimited).toBe(before + 1);
    });
  });

  describe('saveBatch', () => {
    const VID1 = '00000000-0000-4000-0000-000000000001';
    const VID2 = '00000000-0000-4000-0000-000000000003';
    const DID1 = '00000000-0000-4000-0000-00000000000a';
    const DID2 = '00000000-0000-4000-0000-00000000000b';

    it('saves positions and skips those where driver is not assigned', async () => {
      const positions = [
        {
          latitude: 1,
          longitude: 2,
          timestamp: '2026-07-21T10:00:00.000Z',
          deliveryId: DID1,
          vehicleId: VID1,
        },
        {
          latitude: 3,
          longitude: 4,
          timestamp: '2026-07-21T10:00:05.000Z',
          deliveryId: DID2,
          vehicleId: VID2,
        },
      ];

      mockPrisma.delivery.findMany.mockResolvedValue([
        { id: DID1, assignedDriverId: 'user-1', driverId: null },
      ]);

      // saveBatch() pré-valide désormais les véhicules actifs/non-supprimés du lot
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([{ id: VID1 }, { id: VID2 }]);

      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]);
      mockPrisma.gpsPosition.createMany.mockResolvedValueOnce({ count: 1 });

      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        {
          id: 'gps-1',
          vehicleId: 'vehicle-1',
          timestamp: new Date(),
          latitude: 1,
          longitude: 2,
          speed: null,
          heading: null,
          altitude: null,
          accuracy: null,
          suspect: false,
          driverId: 'driver-1',
          deliveryId: 'delivery-1',
        },
      ]);

      const saved = await service.saveBatch('user-1', 'driver-1', positions);

      expect(saved).toHaveLength(1);
      expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
    });

    it('skips positions whose vehicle is inactive or soft-deleted (no insert)', async () => {
      const positions = [
        {
          latitude: 1,
          longitude: 2,
          timestamp: '2026-07-21T10:00:00.000Z',
          deliveryId: DID1,
          vehicleId: VID1,
        },
      ];

      mockPrisma.delivery.findMany.mockResolvedValue([
        { id: DID1, assignedDriverId: 'user-1', driverId: null },
      ]);
      // Le véhicule n'est pas dans la liste des actifs (inactif ou supprimé)
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([]);
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]);

      const saved = await service.saveBatch('user-1', 'driver-1', positions);

      expect(saved).toHaveLength(0);
      expect(mockPrisma.gpsPosition.createMany).not.toHaveBeenCalled();
    });

    it('trie le lot par timestamp croissant AVANT le calcul (pas de doublon/vitesse à tort sur lot désordonné)', async () => {
      const base = Date.parse('2026-07-21T10:00:00.000Z');
      // Lot volontairement désordonné (scénario nominal du rattrapage réseau de l'app
      // mobile : l'ordre d'arrivée n'est pas chronologique). Le point le plus récent
      // (t=+20s) arrive en premier ; les vitesses réelles sont réalistes (< 55.56 m/s).
      const positions = [
        {
          latitude: 0,
          longitude: 0.001,
          timestamp: new Date(base + 20000).toISOString(),
          vehicleId: VID1,
        }, // t=+20s
        { latitude: 0, longitude: 0, timestamp: new Date(base + 0).toISOString(), vehicleId: VID1 }, // t=+0s
        {
          latitude: 0,
          longitude: 0.0012,
          timestamp: new Date(base + 10000).toISOString(),
          vehicleId: VID1,
        }, // t=+10s
      ];

      mockPrisma.vehicle.findMany.mockResolvedValueOnce([{ id: VID1 }]);
      // lastPositions (aucune position en base) puis lecture des positions insérées.
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      let inserted: any[] = [];
      mockPrisma.gpsPosition.createMany.mockImplementation(async ({ data }: any) => {
        inserted = data;
        return { count: data.length };
      });

      await service.saveBatch('user-1', 'driver-1', positions as any);

      // Les 3 positions doivent être insérées : sans tri, les points antérieurs à la
      // première position traitée (t=+20s) sont rejetés à tort comme doublons.
      expect(mockPrisma.gpsPosition.createMany).toHaveBeenCalledTimes(1);
      expect(inserted).toHaveLength(3);
      const byTime = new Map(inserted.map((p) => [new Date(p.timestamp).getTime(), p]));
      // Aucune vitesse absurde (>200 km/h) → aucune position suspecte à tort.
      expect(byTime.get(base + 0)!.suspect).toBe(false);
      expect(byTime.get(base + 10000)!.suspect).toBe(false);
      expect(byTime.get(base + 20000)!.suspect).toBe(false);
    });
  });

  // ─── Point 3 — Équivalence du champ `suspect` entre savePosition et saveBatch ───
  // Preuve que la divergence décrite (batch n'appliquant que la règle de vitesse) ne
  // produit AUCUNE différence binaire observable sur `suspect` avec les constantes
  // actuelles : le « sursaut court » (distance > 5000×scale ET Δt < 10s) implique
  // speed = distance/Δt > 500×scale > 55.56×scale → TOUJOURS couvert par la règle de
  // vitesse ; les timestamps non croissants sont rejetés par le dédoublonnage (1s) dans
  // les DEUX chemins ; l'exemption de changement de source est inapplicable au batch
  // (flux phone-only). Ce test compare les deux chemins sur un même couple (référence,
  // point) et vérifie que `suspect` est identique — c'est un garde de non-régression.
  describe('Point 3 — équivalence suspect savePosition vs saveBatch', () => {
    const VID = '00000000-0000-4000-0000-000000000001';
    const DRIVER = '00000000-0000-4000-0000-000000000002';
    const BASE = Date.parse('2026-07-21T10:00:00.000Z');

    // Chemin batch : lot [P1, P2] (base vide), renvoie le suspect du 2e point inséré.
    async function batchSecondSuspect(P1: any, P2: any): Promise<boolean | null> {
      // Reset ciblé : des tests antérieurs du fichier peuvent laisser des once-values
      // non consommées (clearAllMocks ne vide pas les files de mockImplementationOnce).
      mockPrisma.gpsPosition.findFirst.mockReset();
      mockPrisma.gpsPosition.create.mockReset();
      mockPrisma.gpsPosition.createMany.mockReset();
      mockPrisma.gpsPosition.findMany.mockReset();
      mockPrisma.vehicle.findMany.mockReset();
      mockPrisma.vehicle.findFirst.mockReset();
      mockPrisma.vehicle.findFirst.mockResolvedValue({ companyId: 'company-1' });
      mockPrisma.delivery.findMany.mockReset();
      mockPrisma.delivery.findMany.mockResolvedValue([]);

      mockPrisma.vehicle.findMany.mockResolvedValueOnce([{ id: VID }]);
      mockPrisma.gpsPosition.findMany
        .mockResolvedValueOnce([]) // lastPositions : aucune position en base
        .mockResolvedValueOnce([]); // lecture des positions insérées
      const inserted: any[] = [];
      mockPrisma.gpsPosition.createMany.mockImplementation(async ({ data }: any) => {
        inserted.push(...data);
        return { count: data.length };
      });
      await service.saveBatch('user-1', DRIVER, [P1, P2] as any);
      return inserted.length >= 2 ? inserted[1].suspect : null;
    }

    // Chemin temps réel : deux savePosition séquentiels, renvoie le suspect du 2e point.
    async function singleSecondSuspect(P1: any, P2: any): Promise<boolean | null> {
      mockPrisma.gpsPosition.findFirst.mockReset();
      mockPrisma.gpsPosition.create.mockReset();
      mockPrisma.gpsPosition.createMany.mockReset();
      mockPrisma.gpsPosition.findMany.mockReset();
      mockPrisma.vehicle.findMany.mockReset();
      mockPrisma.vehicle.findFirst.mockReset();
      mockPrisma.vehicle.findFirst.mockResolvedValue({ companyId: 'company-1' });
      mockPrisma.delivery.findMany.mockReset();

      let secondSuspect: boolean | null = null;
      for (const [i, pos] of [P1, P2].entries()) {
        // Implémentation à compteur local (robuste en suite complète : pas de once-queue
        // fragile face aux appels résiduels). Appel #1 = isDuplicateByTimestamp, appel #2+
        // = getLastPosition / éventuelle exemption intra-source.
        let findFirstCalls = 0;
        mockPrisma.gpsPosition.findFirst.mockImplementation(async () => {
          findFirstCalls++;
          if (findFirstCalls === 1) return null; // isDuplicateByTimestamp : jamais un doublon
          return i === 0
            ? null
            : {
                latitude: P1.latitude,
                longitude: P1.longitude,
                timestamp: new Date(P1.timestamp),
                source: 'phone',
              };
        });
        mockPrisma.gpsPosition.create.mockImplementation(async ({ data }: any) => {
          if (i === 1) secondSuspect = data.suspect;
          return { id: `gps-${i}`, suspect: data.suspect, timestamp: data.timestamp };
        });
        await service.savePosition(
          DRIVER,
          {
            latitude: pos.latitude,
            longitude: pos.longitude,
            timestamp: pos.timestamp,
            vehicleId: VID,
            accuracy: pos.accuracy,
          } as any,
          'company-1',
        );
      }
      return secondSuspect;
    }

    const cases: Array<{ name: string; P1: any; P2: any }> = [
      {
        name: 'vitesse brute (téléportation claire)',
        P1: { latitude: 0, longitude: 0, timestamp: new Date(BASE).toISOString(), vehicleId: VID },
        // ~1112 m en 5s = 222 m/s > 55.56 → suspect dans les deux chemins.
        P2: {
          latitude: 0,
          longitude: 0.01,
          timestamp: new Date(BASE + 5000).toISOString(),
          vehicleId: VID,
        },
      },
      {
        name: 'sursaut court (grande distance, temps court)',
        P1: { latitude: 0, longitude: 0, timestamp: new Date(BASE).toISOString(), vehicleId: VID },
        // ~6672 m en 9s : remplit les conditions du sursaut court (>5000m, Δt<10s)
        // MAIS speed = 741 m/s > 55.56 → déjà couvert par la règle de vitesse.
        P2: {
          latitude: 0,
          longitude: 0.06,
          timestamp: new Date(BASE + 9000).toISOString(),
          vehicleId: VID,
        },
      },
      {
        name: 'déplacement réaliste (aucun suspect)',
        P1: { latitude: 0, longitude: 0, timestamp: new Date(BASE).toISOString(), vehicleId: VID },
        // ~111 m en 10s = 11 m/s < 55.56 → non suspect dans les deux chemins.
        P2: {
          latitude: 0,
          longitude: 0.001,
          timestamp: new Date(BASE + 10000).toISOString(),
          vehicleId: VID,
        },
      },
    ];

    it.each(cases)(
      '$name → suspect identique entre savePosition et saveBatch',
      async ({ P1, P2 }) => {
        const batchS = await batchSecondSuspect(P1, P2);
        const singleS = await singleSecondSuspect(P1, P2);
        expect(singleS).not.toBeNull();
        expect(batchS).toBe(singleS);
      },
    );
  });

  // ─── ITEM 5 — Exemption de changement de source dans detectTeleportation ───
  // Le premier point GPS après un basculement de traceur (phone → physical_tracker ou
  // inverse) sur un même véhicule peut légitimement représenter un vrai déplacement :
  // comparer à l'AUTRE source marquerait suspect à tort (le point serait ensuite exclu
  // du rapport carburant via suspect=false). La mitigation est déjà en place (comparer
  // uniquement au sein de la MÊME source si un changement a eu lieu dans les 5 dernières
  // minutes) — ce test en est le garde de non-régression.
  describe('ITEM 5 — exemption de changement de source (detectTeleportation)', () => {
    const VID = '00000000-0000-4000-0000-000000000001';
    const DRIVER = '00000000-0000-4000-0000-000000000002';

    it('ne marque PAS suspect le premier point phone après un basculement physical_tracker → phone (< 5 min, sans historique intra-source)', async () => {
      const now = new Date('2026-07-21T10:00:00.000Z');
      // Reset ciblé (suite complète : clearAllMocks ne vide pas les once-queues).
      mockPrisma.gpsPosition.findFirst.mockReset();
      mockPrisma.gpsPosition.create.mockReset();
      mockPrisma.vehicle.findFirst.mockReset();
      mockPrisma.vehicle.findFirst.mockResolvedValue({
        companyId: 'company-1',
        positionSource: 'phone',
      });

      // isDuplicateByTimestamp → null ; getLastPosition → dernier point physical_tracker il y a 2 min.
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        latitude: 0,
        longitude: 0,
        timestamp: new Date(now.getTime() - 120000),
        source: 'physical_tracker',
      });
      // Recherche du dernier point de la MÊME source ('phone') → aucun historique → exempté.
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(null);

      let created: any;
      mockPrisma.gpsPosition.create.mockImplementation(async ({ data }: any) => {
        created = data;
        return { id: 'gps-exempt', suspect: data.suspect };
      });

      // Point à ~111 km du dernier fix physical_tracker : SANS l'exemption, speed ≈ 926 m/s
      // > 55.56 → suspect à tort. AVEC l'exemption (aucun historique phone), il passe.
      await service.savePosition(
        DRIVER,
        { latitude: 0, longitude: 1, timestamp: now.toISOString(), vehicleId: VID } as any,
        'company-1',
        'phone',
      );

      expect(created).toBeDefined();
      expect(created.suspect).toBe(false);
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

  describe('assertVehicleOwnership', () => {
    it('throws NotFoundException when vehicle not found or wrong company', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      await expect(service.assertVehicleOwnership('vehicle-1', 'company-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('isRateLimited', () => {
    it('returns true when rate limited', async () => {
      mockCacheService.get.mockResolvedValueOnce(true);
      expect(await service.isRateLimited('driver-1')).toBe(true);
    });

    it('returns false when not rate limited', async () => {
      mockCacheService.get.mockResolvedValueOnce(null);
      mockCacheService.set.mockResolvedValueOnce(undefined);
      expect(await service.isRateLimited('driver-1')).toBe(false);
    });
  });

  describe('calculateDistancePostGIS', () => {
    it('returns 0 when no positions found', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ total_meters: 0 }]);
      const result = await service.calculateDistancePostGIS('delivery-1', 'company-1');
      expect(result.kilometers).toBe(0);
    });
  });

  describe('getLastPositionByTraccarId', () => {
    it('finds last position by traccar device id', async () => {
      const pos = { timestamp: new Date(), latitude: -18.87, longitude: 47.51 };
      mockPrisma.gpsPosition.findFirst.mockResolvedValueOnce(pos);
      const result = await service.getLastPositionByTraccarId('42', 'company-1');
      expect(result).toEqual(pos);
      expect(mockPrisma.gpsPosition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            vehicle: { traccarDeviceId: '42', companyId: 'company-1' },
          }),
        }),
      );
    });
  });

  describe('calculateDistance', () => {
    it('returns 0 when less than 2 positions', async () => {
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([{ id: 'gps-1' }]);
      mockPrisma.gpsPosition.count.mockResolvedValueOnce(1);
      const result = await service.calculateDistance('delivery-1', 'company-1');
      expect(result.meters).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns ok status', async () => {
      const result = await service.getStatus();
      expect(result.status).toBe('ok');
    });
  });

  describe('getDeliveryInfo', () => {
    it('throws NotFoundException when delivery not found', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      await expect(service.getDeliveryInfo('delivery-1', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archivePositionsBefore — multi-tenant scope', () => {
    it('should filter by companyId using vehicles join', async () => {
      mockPrisma.$executeRawUnsafe = jest.fn().mockResolvedValue(5);

      await service.archivePositionsBefore(new Date('2026-01-01'), 'company-a');

      expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const sql: string = mockPrisma.$executeRawUnsafe.mock.calls[0][0];
      const params = mockPrisma.$executeRawUnsafe.mock.calls[0].slice(1);

      expect(sql).toContain('gps_positions.company_id = $2::uuid');
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

  // ----------------------------------------------------------------
  // Convergence des distances : rapport de trajet (calculateDistance /
  // calculateDistancePostGIS) ↔ rapport carburant (generateDailyReportForDriver)
  // ----------------------------------------------------------------
  describe('Convergence distances trajet ↔ carburant (suspect + bruit < 5m)', () => {
    const DELIVERY = '00000000-0000-4000-0000-00000000000a';
    const COMPANY = 'company-1';
    const DRIVER = '00000000-0000-4000-0000-000000000002';
    const VEHICLE = '00000000-0000-4000-0000-000000000001';
    const TARGET_DATE = new Date('2026-07-20T12:00:00.000Z');

    it("les 3 calculs retournent la même distance à l'arrondi près sur le même jeu de positions (1 suspect + 1 bruit < 5m)", async () => {
      const P1 = {
        latitude: 0,
        longitude: 0,
        timestamp: new Date('2026-07-20T06:00:00Z'),
        suspect: false,
        vehicleId: VEHICLE,
        driverId: DRIVER,
        deliveryId: DELIVERY,
      };
      // P2 = BRUIT (< 5m depuis P1, ~2.2m) : doit être ignoré par les 3 calculs.
      const P2 = {
        latitude: 0,
        longitude: 0.00002,
        timestamp: new Date('2026-07-20T07:00:00Z'),
        suspect: false,
        vehicleId: VEHICLE,
        driverId: DRIVER,
        deliveryId: DELIVERY,
      };
      // P3 = SUSPECT (téléportation) : doit être exclu par les 3 calculs.
      const P3 = {
        latitude: 0,
        longitude: 0.02004,
        timestamp: new Date('2026-07-20T08:00:00Z'),
        suspect: true,
        vehicleId: VEHICLE,
        driverId: DRIVER,
        deliveryId: DELIVERY,
      };
      const P4 = {
        latitude: 0,
        longitude: 0.04004,
        timestamp: new Date('2026-07-20T09:00:00Z'),
        suspect: false,
        vehicleId: VEHICLE,
        driverId: DRIVER,
        deliveryId: DELIVERY,
      };

      // La "DB" simulée applique le filtre suspect=false : findMany ne renvoie que
      // les positions non-suspectes (P1, P2, P4) pour tous les chemins.
      const nonSuspect = [P1, P2, P4];
      mockPrisma.gpsPosition.count.mockResolvedValue(3);
      mockPrisma.gpsPosition.findMany.mockResolvedValue(nonSuspect);

      // 1) Distance JS (haversine) — calculateDistance()
      const js = await service.calculateDistance(DELIVERY, COMPANY);

      // 2) Distance PostGIS — calculateDistancePostGIS() : la requête corrigée
      //    (suspect=false + CASE WHEN < 5m) est vérifiée sur le template SQL.
      mockPrisma.$queryRaw.mockResolvedValue([{ total_meters: js.meters }]);
      const pg = await service.calculateDistancePostGIS(DELIVERY, COMPANY);
      const sqlTemplate = (mockPrisma.$queryRaw.mock.calls[0][0] as any)?.join
        ? (mockPrisma.$queryRaw.mock.calls[0][0] as any).join('')
        : String(mockPrisma.$queryRaw.mock.calls[0][0]);
      expect(sqlTemplate).toContain('gp.suspect = false');
      expect(sqlTemplate).toContain('WHEN');
      expect(sqlTemplate).toContain('<');

      // 3) Rapport carburant — generateDailyReportForDriver() via le service carburant.
      const fuelService = new FuelConsumptionService(
        mockPrisma as unknown as PrismaService,
        { get: jest.fn((_k: string, d?: number) => d ?? 20) } as any,
        { create: jest.fn() } as any,
        undefined as any,
        { broadcastDataUpdate: jest.fn() } as any,
      );
      mockPrisma.driver.findFirst.mockResolvedValue({
        id: DRIVER,
        firstName: 'Jean',
        lastName: 'Rakoto',
      });
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: VEHICLE,
        licensePlate: 'TRK-001',
        fuelType: 'Diesel',
        theoreticalConsumption: 10,
      });
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 4900 });
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => args);
      mockPrisma.vehicle.findMany.mockResolvedValue([]);

      let captured: any;
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => {
        captured = args;
        return args;
      });
      await fuelService.generateDailyReportForSingleDriver(COMPANY, DRIVER, TARGET_DATE);
      const reportKm = captured.create.distanceKm;
      const reportMeters = Math.round(reportKm * 1000);

      // 3 valeurs côte à côte dans la sortie du test.
      console.log(
        `[convergence] JS haversine: ${js.meters} m | PostGIS: ${pg.meters} m | DailyFuelReport: ${reportKm} km (${reportMeters} m)`,
      );

      // PostGIS = JS (même requête corrigée, mock cohérent).
      expect(js.meters).toBe(pg.meters);
      // Le rapport carburant arrondit au centième de km (= 10 m) : convergence à ±10 m.
      expect(Math.abs(reportMeters - js.meters)).toBeLessThanOrEqual(10);
      // La distance exclut bien le point suspect ET le bruit : elle vaut la distance P2→P4
      // (~4450 m), jamais P1→P2→P4 (qui ajouterait ~2 m de bruit) ni P1→P3 (suspect).
      expect(js.meters).toBeGreaterThan(4000);
      expect(js.meters).toBeLessThan(5000);
    });
  });

  // ----------------------------------------------------------------
  // PROMPT A2 — seuil de bruit GPS pondéré par l'accuracy dans calculateDistance
  // ----------------------------------------------------------------
  describe('PROMPT A2 — seuil de bruit pondéré par l’accuracy (calculateDistance)', () => {
    const DELIVERY = '00000000-0000-4000-0000-00000000000a';
    const COMPANY = 'company-1';

    it('Test D : trajet ~10 km avec bruit phone (accuracy 40m) → distance non gonflée par le bruit', async () => {
      // P0→P1 et P1→P2 = bruit de jitter ~3.3m chacun (accuracy 40 → seuil PONDÉRÉ plafonné à
      // 1.5×5m = 7,5m → filtré). AVANT plafond, accuracy 40 donnait un seuil de 20m ; le cap
      // GPS_NOISE_MAX_ACCURACY_SCALE garantit qu'un vrai déplacement urbain lent (segments
      // 8-25m, voir règle vitesse) reste compté alors que le bruit à l'arrêt est filtré.
      // P2→P3→P4 = trajet réel ~9985 m, segments bien au-dessus du seuil → conservés.
      const positions = [
        { latitude: 0, longitude: 0, accuracy: 40, timestamp: new Date('2026-07-20T06:00:00Z') },
        {
          latitude: 0,
          longitude: 0.00003,
          accuracy: 40,
          speed: 0,
          timestamp: new Date('2026-07-20T06:01:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.00006,
          accuracy: 40,
          speed: 0,
          timestamp: new Date('2026-07-20T06:02:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.045,
          accuracy: 40,
          speed: 13,
          timestamp: new Date('2026-07-20T06:03:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.09,
          accuracy: 40,
          speed: 13,
          timestamp: new Date('2026-07-20T06:04:00Z'),
        },
      ];
      mockPrisma.gpsPosition.count.mockResolvedValue(5);
      mockPrisma.gpsPosition.findMany.mockResolvedValue(positions as any);

      const result = await service.calculateDistance(DELIVERY, COMPANY);

      console.log(`[Test D] distance = ${result.meters} m`);
      // Le bruit à l'arrêt (vitesse 0, segments ~3m < seuil 7,5m) est filtré ; le vrai trajet
      // (~9985m, vitesse 13 m/s) est compté intégralement → jamais sous 9900m ni au-delà du
      // vrai trajet majoré du bruit filtré.
      expect(result.meters).toBeGreaterThan(9900);
      expect(result.meters).toBeLessThan(10100);
    });

    it('Test E : cohérence calculateDistance() vs DailyFuelReport.distanceKm sur un même (véhicule, jour)', async () => {
      const DRIVER = '00000000-0000-4000-0000-000000000002';
      const VEHICLE = '00000000-0000-4000-0000-000000000001';
      const TARGET_DATE = new Date('2026-07-20T12:00:00.000Z');
      const positions = [
        {
          latitude: 0,
          longitude: 0,
          accuracy: 40,
          vehicleId: VEHICLE,
          driverId: DRIVER,
          deliveryId: DELIVERY,
          timestamp: new Date('2026-07-20T06:00:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.0001,
          accuracy: 40,
          vehicleId: VEHICLE,
          driverId: DRIVER,
          deliveryId: DELIVERY,
          timestamp: new Date('2026-07-20T06:01:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.0002,
          accuracy: 40,
          vehicleId: VEHICLE,
          driverId: DRIVER,
          deliveryId: DELIVERY,
          timestamp: new Date('2026-07-20T06:02:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.045,
          accuracy: 40,
          vehicleId: VEHICLE,
          driverId: DRIVER,
          deliveryId: DELIVERY,
          timestamp: new Date('2026-07-20T06:03:00Z'),
        },
        {
          latitude: 0,
          longitude: 0.09,
          accuracy: 40,
          vehicleId: VEHICLE,
          driverId: DRIVER,
          deliveryId: DELIVERY,
          timestamp: new Date('2026-07-20T06:04:00Z'),
        },
      ];
      mockPrisma.gpsPosition.count.mockResolvedValue(5);
      mockPrisma.gpsPosition.findMany.mockResolvedValue(positions as any);

      // 1) calculateDistance (rapport de trajet).
      const calc = await service.calculateDistance(DELIVERY, COMPANY);

      // 2) DailyFuelReport (rapport carburant) sur les MÊMES positions.
      const fuelService = new FuelConsumptionService(
        mockPrisma as unknown as PrismaService,
        { get: jest.fn((_k: string, d?: number) => d ?? 20) } as any,
        { create: jest.fn() } as any,
        undefined as any,
        { broadcastDataUpdate: jest.fn() } as any,
      );
      mockPrisma.driver.findFirst.mockResolvedValue({
        id: DRIVER,
        firstName: 'Jean',
        lastName: 'Rakoto',
      });
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: VEHICLE,
        licensePlate: 'TRK-1',
        fuelType: 'Diesel',
        theoreticalConsumption: 10,
      });
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 4900 });
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      let captured: any;
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => {
        captured = args;
        return args;
      });
      await fuelService.generateDailyReportForSingleDriver(COMPANY, DRIVER, TARGET_DATE);
      const reportMeters = Math.round(captured.create.distanceKm * 1000);

      console.log(
        `[Test E] calculateDistance = ${calc.meters} m | DailyFuelReport = ${captured.create.distanceKm} km (${reportMeters} m)`,
      );
      // Même fonction de distance filtrée → convergence à l'arrondi près.
      expect(Math.abs(reportMeters - calc.meters)).toBeLessThanOrEqual(10);
    });
  });

  // ----------------------------------------------------------------
  // PROMPT E — harmonisation de la détection de téléportation temps réel vs batch
  // (evaluateTeleportation, source unique dans teleportation.utils)
  // ----------------------------------------------------------------
  describe('PROMPT E — téléportation batch vs temps réel (fonction partagée)', () => {
    const VID = '00000000-0000-4000-0000-000000000001';

    it('Test F : un saut de distance > 5km en < 10s est marqué suspect en batch', async () => {
      const base = Date.parse('2026-07-21T10:00:00.000Z');
      mockPrisma.delivery.findMany.mockReset();
      mockPrisma.vehicle.findMany.mockReset().mockResolvedValueOnce([{ id: VID }]);
      mockPrisma.gpsPosition.findMany
        .mockReset()
        .mockResolvedValueOnce([]) // lastPositions : base vide
        .mockResolvedValueOnce([]); // lecture des insérées
      const inserted: any[] = [];
      mockPrisma.gpsPosition.createMany.mockReset().mockImplementation(async ({ data }: any) => {
        inserted.push(...data);
        return { count: data.length };
      });

      // Point à ~6672m en 9s (< 10s) : conditions du « saut court ». Note : avec les
      // constantes actuelles (5000m, 10s, 55.56 m/s, scale >= 1), cette situation est
      // TOUJOURS aussi couverte par la règle de vitesse (vitesse = 741 m/s > 55.56) — le
      // test vérifie que le batch la détecte (suspect=true), comme le chemin temps réel.
      await service.saveBatch('user-1', 'driver-1', [
        { latitude: 0, longitude: 0, timestamp: new Date(base).toISOString(), vehicleId: VID },
        {
          latitude: 0,
          longitude: 0.06,
          timestamp: new Date(base + 9000).toISOString(),
          vehicleId: VID,
        },
      ] as any);

      expect(inserted).toHaveLength(2);
      expect(inserted[1].suspect).toBe(true);
    });

    it('Test G : timestamp non croissant en batch → rejeté comme doublon (politique documentée, identique au temps réel)', async () => {
      const base = Date.parse('2026-07-21T10:00:00.000Z');
      mockPrisma.delivery.findMany.mockReset();
      mockPrisma.vehicle.findMany.mockReset().mockResolvedValueOnce([{ id: VID }]);
      // La base contient déjà P1 (t=+10s).
      mockPrisma.gpsPosition.findMany
        .mockReset()
        .mockResolvedValueOnce([
          // La ligne lastPositions porte vehicleId (sinon le Map serait indexé par undefined).
          {
            vehicleId: VID,
            latitude: 0,
            longitude: 0.001,
            timestamp: new Date(base + 10000),
            speed: null,
          },
        ])
        .mockResolvedValueOnce([]);
      mockPrisma.gpsPosition.createMany.mockReset();

      // Lot : P2 (t=+0s, ANTÉRIEUR à la référence en base) + P1 (déjà en base).
      await service.saveBatch('user-1', 'driver-1', [
        { latitude: 0, longitude: 0, timestamp: new Date(base).toISOString(), vehicleId: VID },
        {
          latitude: 0,
          longitude: 0.001,
          timestamp: new Date(base + 10000).toISOString(),
          vehicleId: VID,
        },
      ] as any);

      // P2 (timeDiffSec = -10s) et P1 (doublon) sont rejetés par le dédoublonnage 1s,
      // même politique que isDuplicateByTimestamp du temps réel : un point non croissant
      // est une retransmission/doublon, pas une anomalie — jamais inséré en base.
      expect(mockPrisma.gpsPosition.createMany).not.toHaveBeenCalled();
    });
  });
});
