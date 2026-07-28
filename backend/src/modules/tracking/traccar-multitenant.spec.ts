import { ConflictException } from '@nestjs/common';
import { TrackingService } from './tracking.service';

describe('Traccar multi-tenant isolation', () => {
  let service: TrackingService;
  let mockPrisma: any;
  let mockNotifications: any;
  let mockGeofence: any;
  let mockProximity: any;
  let mockCache: any;
  let mockDataUpdateBus: any;

  const COMPANY_A = 'company-a';
  const COMPANY_B = 'company-b';
  const VEHICLE_A = 'vehicle-a';
  const VEHICLE_B = 'vehicle-b';
  const TRACCAR_ID = '42';

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      vehicle: {
        findFirst: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      gpsPosition: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
      delivery: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      companySettings: { findUnique: jest.fn() },
      geofence: { findMany: jest.fn() },
      geofenceEvent: { findFirst: jest.fn(), create: jest.fn() },
      $executeRawUnsafe: jest.fn(),
      $queryRaw: jest.fn(),
    };

    mockNotifications = { create: jest.fn() };
    mockGeofence = { checkGeofences: jest.fn().mockResolvedValue([]) };
    mockProximity = { checkProximity: jest.fn().mockResolvedValue(undefined) };
    mockCache = { get: jest.fn(), set: jest.fn(), invalidate: jest.fn().mockResolvedValue(undefined) };
    mockDataUpdateBus = { emit: jest.fn(), on: jest.fn() };

    service = new TrackingService(
      mockPrisma as any,
      mockNotifications as any,
      mockGeofence as any,
      mockProximity as any,
      mockCache as any,
      mockDataUpdateBus as any,
    );
  });

  it('rejects linking the same traccarDeviceId to two vehicles', async () => {
    mockPrisma.vehicle.findFirst
      .mockReturnValueOnce({ id: VEHICLE_A, companyId: COMPANY_A })  // find vehicle A
      .mockReturnValueOnce(null)                                      // no conflict
      .mockReturnValueOnce({ id: VEHICLE_B, companyId: COMPANY_B })  // find vehicle B
      .mockReturnValueOnce({ id: VEHICLE_A, companyId: COMPANY_A })  // conflict!
      .mockReturnValueOnce({ id: VEHICLE_B, companyId: COMPANY_B })  // find vehicle B again
      .mockReturnValueOnce({ id: VEHICLE_A, companyId: COMPANY_A }); // conflict! (3rd call)
    mockPrisma.vehicle.update.mockResolvedValue({ id: 'updated' });

    const r1 = await service.linkVehicleToTraccar(VEHICLE_A, COMPANY_A, TRACCAR_ID);
    expect(r1).toEqual({ id: 'updated' });

    await expect(
      service.linkVehicleToTraccar(VEHICLE_B, COMPANY_B, TRACCAR_ID),
    ).rejects.toThrow(ConflictException);

    const e = await service.linkVehicleToTraccar(VEHICLE_B, COMPANY_B, TRACCAR_ID)
      .catch(e => e);
    expect(e.message).toContain(`traccarDeviceId "${TRACCAR_ID}" is already assigned`);
  });

  it('allows different traccarDeviceIds for different vehicles', async () => {
    const calls: any[] = [
      { id: VEHICLE_A, companyId: COMPANY_A },
      null,
      { id: VEHICLE_B, companyId: COMPANY_B },
      null,
    ];
    mockPrisma.vehicle.findFirst.mockImplementation(() => calls.shift() ?? null);
    mockPrisma.vehicle.update.mockResolvedValue({ id: 'updated' });

    await expect(
      service.linkVehicleToTraccar(VEHICLE_A, COMPANY_A, 'device-1'),
    ).resolves.toEqual({ id: 'updated' });

    await expect(
      service.linkVehicleToTraccar(VEHICLE_B, COMPANY_B, 'device-2'),
    ).resolves.toEqual({ id: 'updated' });
  });
});
