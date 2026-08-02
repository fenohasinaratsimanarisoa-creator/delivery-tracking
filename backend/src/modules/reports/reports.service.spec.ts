import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { ReportsService } from './reports.service';

const mockPrisma = {
  delivery: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  vehicle: {
    findMany: jest.fn(),
  },
  fuelLog: {
    findMany: jest.fn(),
  },
  driver: {
    findMany: jest.fn(),
  },
};

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('ReportsService', () => {
  let service: ReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReportsService(
      mockPrisma as unknown as PrismaService,
      mockCache as unknown as CacheService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDeliveryReport', () => {
    it('returns cached report when available', async () => {
      const cached = { total: 10, statusBreakdown: [] };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.getDeliveryReport('company-1');

      expect(result).toEqual(cached);
      expect(mockPrisma.delivery.count).not.toHaveBeenCalled();
    });

    it('computes delivery report and caches it', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.delivery.count.mockResolvedValue(10);
      const dateRow = { createdAt: new Date('2026-07-25') };
      mockPrisma.delivery.findMany
        .mockResolvedValueOnce([
          { completedAt: new Date('2026-07-26'), scheduledDate: new Date('2026-07-26'), createdAt: new Date('2026-07-25') },
        ])
        .mockResolvedValueOnce([dateRow, { createdAt: new Date('2026-07-26') }])
        .mockResolvedValueOnce([dateRow])
        .mockResolvedValueOnce([dateRow]);

      const result = await service.getDeliveryReport('company-1');

      expect(result.total).toBe(10);
      expect(result.statusBreakdown).toHaveLength(6);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('getFleetReport', () => {
    it('returns cached fleet report when available', async () => {
      const cached = { vehicles: [], totalDistance: 0, totalFuel: 0, activeCount: 0, onlineCount: 0 };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.getFleetReport('company-1');

      expect(result).toEqual(cached);
    });

    it('computes fleet report with vehicle data', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: 'vehicle-1',
          brand: 'Toyota',
          model: 'Hilux',
          licensePlate: 'TRK-001',
          isActive: true,
          deliveries: [{ id: 'del-1' }],
          gpsPositions: [{ latitude: -18.91, longitude: 47.52, timestamp: new Date(), speed: 30 }],
        },
      ]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
        {
          liters: 50,
          kilometers: 500,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: false,
          gpsAnomalyFlag: false,
        },
      ]);

      const result = await service.getFleetReport('company-1');

      expect(result.vehicles).toHaveLength(1);
      expect(result.vehicles[0].vehicleName).toBe('Toyota Hilux');
      expect(result.vehicles[0].fuelLiters).toBe(50);
      expect(result.vehicles[0].distanceKm).toBe(500);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });

  describe('getDriverReport', () => {
    it('returns cached driver report when available', async () => {
      const cached = { drivers: [], totalDeliveries: 0, totalCompleted: 0, overallOnTimeRate: 0 };
      mockCache.get.mockResolvedValueOnce(cached);

      const result = await service.getDriverReport('company-1');

      expect(result).toEqual(cached);
    });

    it('computes driver report with performance metrics', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.driver.findMany.mockResolvedValueOnce([
        {
          id: 'driver-1',
          firstName: 'Alice',
          lastName: 'Driver',
          phone: '+261123456789',
          isActive: true,
          deliveries: [
            { id: 'del-1', status: 'delivered', completedAt: new Date('2026-07-26'), scheduledDate: new Date('2026-07-26') },
            { id: 'del-2', status: 'delivered', completedAt: new Date('2026-07-27'), scheduledDate: new Date('2026-07-26') },
            { id: 'del-3', status: 'failed', completedAt: null, scheduledDate: null },
          ],
        },
      ]);

      const result = await service.getDriverReport('company-1');

      expect(result.drivers).toHaveLength(1);
      expect(result.drivers[0].driverName).toBe('Alice Driver');
      expect(result.drivers[0].totalDeliveries).toBe(3);
      expect(result.drivers[0].completedDeliveries).toBe(2);
      expect(result.drivers[0].onTimeDeliveries).toBe(1);
      expect(result.drivers[0].onTimeRate).toBe(50);
      expect(mockCache.set).toHaveBeenCalled();
    });
  });
});
