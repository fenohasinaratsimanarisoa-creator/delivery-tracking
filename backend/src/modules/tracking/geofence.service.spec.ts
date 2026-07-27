import { GeofenceService } from './geofence.service';

const mockPrisma = {
  geofence: {
    findMany: jest.fn(),
  },
  geofenceEvent: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
};

describe('GeofenceService', () => {
  let service: GeofenceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GeofenceService(mockPrisma as any);
  });

  const deliveryId = 'delivery-1';
  const vehicleId = 'vehicle-1';
  const baseLat = -18.8792;
  const baseLng = 47.5079;

  it('returns empty array when no geofences exist for delivery', async () => {
    mockPrisma.geofence.findMany.mockResolvedValue([]);

    const result = await service.checkGeofences(deliveryId, vehicleId, baseLat, baseLng);

    expect(result).toEqual([]);
  });

  it('returns entry event when vehicle enters a single geofence', async () => {
    mockPrisma.geofence.findMany.mockResolvedValue([
      { id: 'gf-1', name: 'Zone A', lat: baseLat, lng: baseLng, radiusMeters: 200 },
    ]);
    mockPrisma.geofenceEvent.findFirst.mockResolvedValue(null);

    const result = await service.checkGeofences(deliveryId, vehicleId, baseLat, baseLng);

    expect(mockPrisma.geofenceEvent.create).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ event: 'entry', geofenceId: 'gf-1', geofenceName: 'Zone A' });
  });

  it('returns BOTH entry events when vehicle enters 2 simultaneous geofences', async () => {
    mockPrisma.geofence.findMany.mockResolvedValue([
      { id: 'gf-1', name: 'Zone A', lat: baseLat, lng: baseLng, radiusMeters: 200 },
      { id: 'gf-2', name: 'Zone B', lat: baseLat + 0.0005, lng: baseLng + 0.0005, radiusMeters: 200 },
    ]);
    mockPrisma.geofenceEvent.findFirst.mockResolvedValue(null);

    const result = await service.checkGeofences(deliveryId, vehicleId, baseLat, baseLng);

    expect(mockPrisma.geofenceEvent.create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.geofenceId)).toEqual(expect.arrayContaining(['gf-1', 'gf-2']));
    expect(result.map((r) => r.event)).toEqual(['entry', 'entry']);
  });

  it('returns exit event when vehicle leaves a geofence it was inside', async () => {
    mockPrisma.geofence.findMany.mockResolvedValue([
      { id: 'gf-1', name: 'Zone A', lat: baseLat, lng: baseLng, radiusMeters: 200 },
    ]);
    mockPrisma.geofenceEvent.findFirst.mockResolvedValue({ geofenceId: 'gf-1', event: 'entry' });

    const result = await service.checkGeofences(deliveryId, vehicleId, baseLat + 1, baseLng + 1);

    expect(mockPrisma.geofenceEvent.create).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ event: 'exit', geofenceId: 'gf-1', geofenceName: 'Zone A' });
  });

  it('returns entry + exit events for different geofences simultaneously', async () => {
    const farLat = baseLat + 1;
    const farLng = baseLng + 1;

    mockPrisma.geofence.findMany.mockResolvedValue([
      { id: 'gf-1', name: 'Zone A', lat: baseLat, lng: baseLng, radiusMeters: 200 },
      { id: 'gf-2', name: 'Zone B', lat: farLat, lng: farLng, radiusMeters: 200 },
    ]);
    mockPrisma.geofenceEvent.findFirst.mockResolvedValue({ geofenceId: 'gf-1', event: 'entry' });

    const result = await service.checkGeofences(deliveryId, vehicleId, farLat, farLng);

    expect(result).toHaveLength(2);
    const eventTypes = result.map((r) => r.event);
    expect(eventTypes).toContain('exit');
    expect(eventTypes).toContain('entry');
    expect(result.find((r) => r.geofenceId === 'gf-1')?.event).toBe('exit');
    expect(result.find((r) => r.geofenceId === 'gf-2')?.event).toBe('entry');
  });
});
