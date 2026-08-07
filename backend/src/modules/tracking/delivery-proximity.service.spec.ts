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

  it('cleans up the correct delivery key when in_progress becomes delivered', async () => {
    const firstDeliveryId = 'delivery-1';
    const secondDeliveryId = 'delivery-2';

    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });

    mockPrisma.delivery.findFirst
      .mockResolvedValueOnce({
        id: firstDeliveryId,
        title: 'First Delivery',
        deliveryLat,
        deliveryLng,
      })
      .mockResolvedValueOnce(null);

    mockCacheService.get.mockResolvedValue(null);

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat + 0.001,
      deliveryLng + 0.001,
      now,
    );

    expect(mockCacheService.invalidate).not.toHaveBeenCalled();

    await service.checkProximity(
      driverId,
      vehicleId,
      companyId,
      deliveryLat + 0.001,
      deliveryLng + 0.001,
      now,
    );

    expect(mockCacheService.invalidate).toHaveBeenCalledWith(
      `proximity:entered:${firstDeliveryId}:${vehicleId}`,
    );
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

  it('does NOT re-emit proximityAlert after a server snooze (dismiss) while still within 300m', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: driverId, userId });
    mockPrisma.delivery.findFirst.mockResolvedValue({
      id: deliveryId,
      title: 'Test',
      deliveryLat,
      deliveryLng,
    });

    // Simule un store partagé (comme Redis) : snoozeProximity() écrit la clé,
    // isSnoozed()/getEnteredTime() la lisent.
    const store = new Map<string, number>();
    mockCacheService.set.mockImplementation((key: string, val: number) => {
      store.set(key, val);
      return Promise.resolve();
    });
    mockCacheService.get.mockImplementation((key: string) =>
      Promise.resolve(store.get(key) ?? null),
    );

    // 1) Position dans le rayon de 300m → 1er événement proximityAlert.
    await service.checkProximity(driverId, vehicleId, companyId, deliveryLat, deliveryLng, now);
    expect(mockDataUpdateBus.emitUpdate).toHaveBeenCalledTimes(1);

    // 2) Le chauffeur fait dismiss → snooze serveur écrit.
    await service.snoozeProximity(deliveryId, vehicleId, 0);

    // 3) Nouvelle position TOUJOURS dans le rayon, dans la fenêtre de snooze →
    //    AUCUN nouvel événement (throttling serveur réel).
    mockDataUpdateBus.emitUpdate.mockClear();
    await service.checkProximity(driverId, vehicleId, companyId, deliveryLat, deliveryLng, now);
    expect(mockDataUpdateBus.emitUpdate).not.toHaveBeenCalled();

    // 4) La clé de snooze est écrite avec l'expiration SNOOZE_MS (5 min) pour escalation 0.
    expect(mockCacheService.set).toHaveBeenCalledWith(
      `proximity:snoozed:${deliveryId}:${vehicleId}`,
      expect.any(Number),
      300, // 5 * 60 s
    );
  });

  it('snoozeProximity uses ESCALATION_SNOOZE_MS (2 min) for escalationLevel >= 2', async () => {
    await service.snoozeProximity(deliveryId, vehicleId, 2);

    expect(mockCacheService.set).toHaveBeenCalledWith(
      `proximity:snoozed:${deliveryId}:${vehicleId}`,
      expect.any(Number),
      120, // 2 * 60 s
    );
  });
});
