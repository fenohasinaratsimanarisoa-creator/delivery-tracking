import { ConfigService } from '@nestjs/config';
import { NotificationPriority, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FuelConsumptionService } from './fuel-consumption.service';

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  fuelLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
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

  describe('create', () => {
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
