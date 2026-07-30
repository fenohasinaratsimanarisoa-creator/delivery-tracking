import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationPriority, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FuelConsumptionService } from './fuel-consumption.service';

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  vehicle: {
    findFirst: jest.fn(),
  },
  fuelLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  fuelPriceHistory: {
    findFirst: jest.fn(),
  },
  dailyFuelReport: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  driver: {
    findMany: jest.fn(),
  },
};

const mockConfigService = {
  get: jest.fn(),
};

const mockNotifications = {
  create: jest.fn(),
};

describe('FuelConsumptionService', () => {
  let service: FuelConsumptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue(25);
    service = new FuelConsumptionService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
      mockNotifications as unknown as NotificationsService,
      mockQueue as unknown as any,
    );
  });

  // ----------------------------------------------------------------
  // BUG 1 : Cross-tenant leak on vehicleId
  // ----------------------------------------------------------------
  describe('BUG 1 — create() cross-tenant vehicle check', () => {
    const dto = {
      liters: 60,
      kilometers: 500,
      cost: 120,
      fillDate: '2026-07-21T00:00:00.000Z',
      vehicleId: 'vehicle-other-company',
      notes: 'Full tank',
    };

    it('rejects a vehicle that belongs to another company', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('company-a', dto),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: { id: 'vehicle-other-company', companyId: 'company-a', deletedAt: null },
      });
    });

    it('accepts a vehicle that belongs to the company', async () => {
      const created = { id: 'fuel-ok', vehicleId: 'vehicle-1' };
      const enriched = { ...created, vehicle: { licensePlate: 'TRK-001' } };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1', companyId: 'company-1' });
      mockPrisma.fuelLog.create.mockResolvedValueOnce(created);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await expect(service.create('company-1', {
        liters: 60,
        kilometers: 500,
        cost: 120,
        fillDate: '2026-07-21T00:00:00.000Z',
        vehicleId: 'vehicle-1',
        notes: 'Full tank',
      })).resolves.toEqual(enriched);
    });
  });

  // ----------------------------------------------------------------
  // BUG 2 : Fuel price history broken — getFuelPriceForDate()
  // ----------------------------------------------------------------
  describe('BUG 2 — getFuelPriceForDate historical price lookup', () => {
    it('returns the old price when the date falls in its effective window (even if a newer open price exists)', async () => {
      const oldPrice = { pricePerLiter: 4500 };
      const newPrice = { pricePerLiter: 5200 };

      mockPrisma.fuelPriceHistory.findFirst
        .mockResolvedValueOnce(oldPrice);

      const result = await (service as any).getFuelPriceForDate(
        'company-1', 'gasoil', new Date('2026-05-15'),
      );

      expect(result).toBe(4500);
      expect(mockPrisma.fuelPriceHistory.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          fuelType: 'gasoil',
          effectiveFrom: { lte: new Date('2026-05-15') },
          OR: [
            { effectiveUntil: null },
            { effectiveUntil: { gte: new Date('2026-05-15') } },
          ],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
    });

    it('falls back to default when no price matches', async () => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);

      const result = await (service as any).getFuelPriceForDate(
        'company-1', 'essence', new Date('2025-01-01'),
      );

      expect(result).toBe(5000);
    });

    it('prefers the most recent effectiveFrom price that covers the date', async () => {
      const newerPrice = { pricePerLiter: 5300 };
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(newerPrice);

      const result = await (service as any).getFuelPriceForDate(
        'company-1', 'diesel', new Date('2026-07-20'),
      );

      expect(result).toBe(5300);
    });
  });

  // ----------------------------------------------------------------
  // BUG 3 : GPS cross-check not filtered by vehicle
  // ----------------------------------------------------------------
  describe('BUG 3 — crossCheckFuelLogWithGps filters by vehicleId', () => {
    it('aggregates dailyFuelReport scoped to the same vehicleId, not the whole fleet', async () => {
      const fuelLog = {
        id: 'fuel-log-1',
        vehicleId: 'vehicle-a',
        kilometers: 150,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-20'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 100 },
      });

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          vehicleId: 'vehicle-a',
          reportDate: {
            gte: new Date('2026-07-20'),
            lte: new Date('2026-07-25'),
          },
        },
        _sum: { distanceKm: true },
      });
    });

    it('does NOT flag an anomaly when the vehicle GPS distance matches (filter prevents fleet pollution)', async () => {
      const fuelLog = {
        id: 'fuel-log-2',
        vehicleId: 'vehicle-a',
        kilometers: 90,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-18'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 85 },
      });

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Existing tests (must continue to pass)
  // ----------------------------------------------------------------
  describe('create (existing)', () => {
    const dto = {
      liters: 60,
      kilometers: 500,
      cost: 120,
      fillDate: '2026-07-21T00:00:00.000Z',
      vehicleId: 'vehicle-1',
      notes: 'Full tank',
    };

    it('creates a fuel log, enqueues analysis, and returns the enriched record', async () => {
      const created = { id: 'fuel-1', vehicleId: 'vehicle-1' };
      const enriched = { ...created, vehicle: { licensePlate: 'TRK-001' } };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1', companyId: 'company-1' });
      mockPrisma.fuelLog.create.mockResolvedValueOnce(created);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await expect(service.create('company-1', dto)).resolves.toEqual(enriched);
      expect(mockPrisma.fuelLog.create).toHaveBeenCalledWith({
        data: {
          liters: 60,
          kilometers: 500,
          cost: 120,
          fillDate: new Date('2026-07-21T00:00:00.000Z'),
          notes: 'Full tank',
          vehicleId: 'vehicle-1',
          companyId: 'company-1',
        },
        include: { vehicle: true },
      });
      expect(mockQueue.add).toHaveBeenCalledWith('analyze', {
        fuelLogId: 'fuel-1',
        vehicleId: 'vehicle-1',
        companyId: 'company-1',
      });
    });

    it('enqueues analysis with the correct payload and logs regardless of anomaly', async () => {
      const created = { id: 'fuel-2', vehicleId: 'vehicle-2' };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-2', companyId: 'company-1' });
      mockPrisma.fuelLog.create.mockResolvedValueOnce(created);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce({
        ...created,
        vehicle: { licensePlate: 'TRK-002' },
      });

      await service.create('company-1', dto);

      expect(mockQueue.add).toHaveBeenCalledWith('analyze', {
        fuelLogId: 'fuel-2',
        vehicleId: 'vehicle-2',
        companyId: 'company-1',
      });
    });
  });

  it('returns paginated logs filtered by vehicle', async () => {
    mockPrisma.fuelLog.findMany.mockResolvedValueOnce([{ id: 'fuel-1' }]);
    mockPrisma.fuelLog.count.mockResolvedValueOnce(6);

    await expect(
      service.findAll('company-1', { vehicleId: 'vehicle-1', page: 2, limit: 5 }),
    ).resolves.toEqual({
      data: [{ id: 'fuel-1' }],
      meta: { total: 6, page: 2, limit: 5, totalPages: 2 },
    });
    expect(mockPrisma.fuelLog.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', vehicleId: 'vehicle-1' },
      skip: 5,
      take: 5,
      orderBy: { fillDate: 'desc' },
      include: {
        vehicle: {
          select: { id: true, brand: true, model: true, licensePlate: true },
        },
      },
    });
  });

  it('throws when a fuel log is not found in the company scope', async () => {
    mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(null);

    await expect(service.findOne('company-1', 'missing')).rejects.toThrow('Fuel log not found');
  });

  it('computes aggregate consumption statistics and anomalies', async () => {
    const anomaly = {
      id: 'fuel-2',
      liters: 30,
      kilometers: 100,
      cost: 80,
      anomalyFlag: true,
    };
    mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
      {
        id: 'fuel-1',
        liters: 50,
        kilometers: 500,
        cost: 100,
        anomalyFlag: false,
      },
      anomaly,
    ]);

    await expect(service.getConsumptionStats('company-1', 'vehicle-1')).resolves.toEqual({
      totalLiters: 80,
      totalKilometers: 600,
      totalCost: 180,
      averageConsumption: (80 / 600) * 100,
      anomalyCount: 1,
      anomalies: [anomaly],
      logCount: 2,
    });
  });
});
