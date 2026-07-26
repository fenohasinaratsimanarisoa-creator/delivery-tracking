import { DeliveryProximityService } from './delivery-proximity.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
  },
};

const mockDataUpdateBus = {
  emitUpdate: jest.fn(),
};

const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  invalidate: jest.fn().mockResolvedValue(undefined),
};

describe('DeliveryProximityService', () => {
  let service: DeliveryProximityService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DeliveryProximityService(
      mockPrisma as any,
      mockDataUpdateBus as any,
      mockCacheService as any,
      null,
    );
  });

  const driverId = 'driver-1';
  const userId = 'user-1';
  const vehicleId = 'vehicle-1';
  const companyId = 'company-1';
  const deliveryId = 'delivery-1';
  const deliveryLat = -18.8792;
  const deliveryLng = 47.5079;
  const now = new Date('2026-07-21T10:00:00.000Z');

  it('does nothing when driver has no userId', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId: null });

    await service.checkProximity(driverId, vehicleId, companyId, 0, 0, now);

    expect(mockDataUpdateBus.emitUpdate).not.toHaveBeenCalled();
  });

  it('does nothing when no in_progress delivery', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue(null);

    await service.checkProximity(driverId, vehicleId, companyId, 0, 0, now);

    expect(mockDataUpdateBus.emitUpdate).not.toHaveBeenCalled();
  });

  it('sends proximityAlert when vehicle is within 300m of delivery point', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test Delivery',
      deliveryLat,
      deliveryLng,
    });
    mockCacheService.get.mockResolvedValue(null);

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat + 0.001,
      deliveryLng + 0.001,
      now,
    );

    expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        entity: 'proximityAlert',
        targetUserId: userId,
        payload: expect.objectContaining({
          type: 'proximity',
          deliveryId,
          urgency: 'normal',
        }),
      }),
    );
  });

  it('sends high urgency when in zone for more than 7.5 min', async () => {
    const enteredAt = Date.now() - 8 * 60 * 1000;
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test',
      deliveryLat,
      deliveryLng,
    });
    mockCacheService.get.mockResolvedValue(enteredAt);

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat,
      deliveryLng,
      new Date(),
    );

    expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        entity: 'proximityAlert',
        targetUserId: userId,
        payload: expect.objectContaining({
          urgency: 'high',
        }),
      }),
    );
  });

  it('sends critical urgency after 15 min in zone', async () => {
    const enteredAt = Date.now() - 16 * 60 * 1000;
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test',
      deliveryLat,
      deliveryLng,
    });
    mockCacheService.get.mockResolvedValue(enteredAt);

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat,
      deliveryLng,
      new Date(),
    );

    expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        entity: 'proximityAlert',
        targetUserId: userId,
        payload: expect.objectContaining({
          urgency: 'critical',
        }),
      }),
    );
  });

  it('does NOT alert when snoozed', async () => {
    const snoozedUntil = Date.now() + 60 * 1000;
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test',
      deliveryLat,
      deliveryLng,
    });
    mockCacheService.get
      .mockResolvedValueOnce(Date.now()) // enteredTime
      .mockResolvedValueOnce(snoozedUntil); // snoozed

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat,
      deliveryLng,
      new Date(),
    );

    expect(mockDataUpdateBus.emitUpdate).not.toHaveBeenCalled();
  });

  it('clears proximity state when vehicle leaves zone', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test',
      deliveryLat,
      deliveryLng,
    });

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat + 1,
      deliveryLng + 1,
      now,
    );

    expect(mockCacheService.invalidate).toHaveBeenCalled();
    expect(mockDataUpdateBus.emitUpdate).not.toHaveBeenCalled();
  });

  it('handles Traccar positions identically to mobile positions', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Traccar Delivery',
      deliveryLat,
      deliveryLng,
    });
    mockCacheService.get.mockResolvedValue(null);

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat + 0.001,
      deliveryLng + 0.001,
      now,
    );

    expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        entity: 'proximityAlert',
        targetUserId: userId,
        payload: expect.objectContaining({
          type: 'proximity',
          deliveryId,
        }),
      }),
    );
  });
});
