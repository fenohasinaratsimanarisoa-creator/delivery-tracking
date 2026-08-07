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
          {
            completedAt: new Date('2026-07-26'),
            scheduledDate: new Date('2026-07-26'),
            createdAt: new Date('2026-07-25'),
          },
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
      const cached = {
        vehicles: [],
        totalDistance: 0,
        totalFuel: 0,
        activeCount: 0,
        onlineCount: 0,
      };
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
      expect(result.vehicles[0].fuelLitersIncludingAnomalies).toBe(50);
      expect(result.vehicles[0].anomalyCount).toBe(0);
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('excludes anomalous fills from fuelLiters but keeps them in fuelLitersIncludingAnomalies', async () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: 'vehicle-1',
          brand: 'Toyota',
          model: 'Hilux',
          licensePlate: 'TRK-001',
          isActive: true,
          deliveries: [],
          gpsPositions: [{ latitude: -18.91, longitude: 47.52, timestamp: new Date(), speed: 30 }],
        },
      ]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
        // 2 pleins normaux (50 + 40 L)
        {
          liters: 50,
          kilometers: 500,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: false,
          gpsAnomalyFlag: false,
        },
        {
          liters: 40,
          kilometers: 400,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: false,
          gpsAnomalyFlag: false,
        },
        // 1 plein anormal (100 L) : anomalie de consommation
        {
          liters: 100,
          kilometers: 200,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: true,
          gpsAnomalyFlag: false,
        },
      ]);

      const result = await service.getFleetReport('company-1');
      const v = result.vehicles[0];

      console.log(
        `[fleet] fuelLiters=${v.fuelLiters} L, distanceKm=${v.distanceKm} km, ` +
          `avgConsumption=${v.avgConsumption} L/100km, ` +
          `fuelLitersIncludingAnomalies=${v.fuelLitersIncludingAnomalies} L, anomalyCount=${v.anomalyCount}`,
      );
      console.log(
        `[fleet] totalFuel=${result.totalFuel} L, totalFuelIncludingAnomalies=${result.totalFuelIncludingAnomalies} L, anomalyCount=${result.anomalyCount}`,
      );

      // fuelLiters exclut le plein anormal : 50 + 40 = 90
      expect(v.fuelLiters).toBe(90);
      expect(v.distanceKm).toBe(900);
      expect(v.avgConsumption).toBe(10); // 90 / 900 * 100
      // fuelLitersIncludingAnomalies inclut le plein anormal : 50 + 40 + 100 = 190
      expect(v.fuelLitersIncludingAnomalies).toBe(190);
      expect(v.anomalyCount).toBe(1);
      // Totaux flotte
      expect(result.totalFuel).toBe(90);
      expect(result.totalFuelIncludingAnomalies).toBe(190);
      expect(result.anomalyCount).toBe(1);
    });
  });

  describe('fleet export transparency (validated fuel vs excluded anomalies)', () => {
    const fleetMocks = () => {
      mockCache.get.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: 'vehicle-1',
          brand: 'Toyota',
          model: 'Hilux',
          licensePlate: 'TRK-001',
          isActive: true,
          deliveries: [],
          gpsPositions: [{ latitude: -18.91, longitude: 47.52, timestamp: new Date(), speed: 30 }],
        },
      ]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
        // 1 normal (50 L) + 1 anormal (100 L) → validé=50, exclu=100, pleins=1
        {
          liters: 50,
          kilometers: 500,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: false,
          gpsAnomalyFlag: false,
        },
        {
          liters: 100,
          kilometers: 200,
          vehicleId: 'vehicle-1',
          consumptionAnomalyFlag: true,
          gpsAnomalyFlag: false,
        },
      ]);
    };

    it('exportExcel fleet sheet shows "Carburant validé" and the excluded-anomaly line', async () => {
      fleetMocks();

      const buf = await service.exportExcel('fleet', 'company-1');
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as any);
      const ws = wb.getWorksheet('Flotte');
      const texts: string[] = [];
      ws.eachRow((row: any) => {
        const values = Array.isArray(row.values) ? row.values : Object.values(row.values);
        for (const val of values) {
          const v = val && typeof val === 'object' ? (val as any).value : val;
          if (typeof v === 'string') texts.push(v);
        }
      });

      console.log(
        `[excel] lignes de synthèse : ${texts
          .filter((t) => t.includes('Carburant') || t.includes('anomalies'))
          .join(' | ')}`,
      );

      expect(texts).toContain('Carburant validé');
      expect(texts.some((t) => t.includes('dont anomalies exclues, 100 L / 1 pleins'))).toBe(true);
    });

    it('exportPdf fleet renders without error (validated fuel + excluded anomalies lines)', async () => {
      fleetMocks();

      const buf = await service.exportPdf('fleet', 'company-1');

      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(1000);
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
            {
              id: 'del-1',
              status: 'delivered',
              completedAt: new Date('2026-07-26'),
              scheduledDate: new Date('2026-07-26'),
            },
            {
              id: 'del-2',
              status: 'delivered',
              completedAt: new Date('2026-07-27'),
              scheduledDate: new Date('2026-07-26'),
            },
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
