import { PrismaService } from '../../common/prisma/prisma.service';
import { DashboardService } from './dashboard.service';

const mockPrisma = {
  delivery: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  vehicle: {
    count: jest.fn(),
  },
  driver: {
    count: jest.fn(),
  },
  fuelLog: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

const mockCache = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  invalidate: jest.fn().mockResolvedValue(undefined),
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-21T12:00:00.000Z'));
    service = new DashboardService(mockPrisma as unknown as PrismaService, mockCache as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('computes KPI totals and recent fuel statistics', async () => {
    const fuelLogs = [
      { id: 'fuel-1', liters: 50, kilometers: 500 },
      { id: 'fuel-2', liters: 20, kilometers: 100 },
    ];
    mockPrisma.delivery.count.mockResolvedValueOnce(3).mockResolvedValueOnce(20);
    mockPrisma.vehicle.count.mockResolvedValueOnce(8);
    mockPrisma.driver.count.mockResolvedValueOnce(6);
    mockPrisma.fuelLog.findMany.mockResolvedValueOnce(fuelLogs);
    mockPrisma.fuelLog.count.mockResolvedValueOnce(2);

    await expect(service.getKpis('company-1')).resolves.toEqual({
      deliveriesToday: 3,
      totalDeliveries: 20,
      activeVehicles: 8,
      activeDrivers: 6,
      anomalies: 2,
      fuelStats: {
        totalLiters: 70,
        totalKilometers: 600,
        averageConsumption: (70 / 600) * 100,
        recentLogs: fuelLogs,
      },
    });
    expect(mockPrisma.delivery.count).toHaveBeenNthCalledWith(1, {
      where: {
        companyId: 'company-1',
        createdAt: {
          gte: expect.any(Date),
          lt: expect.any(Date),
        },
      },
    });
  });

  it('returns delivery counts for every tracked status', async () => {
    [1, 2, 3, 4, 5, 6].forEach((count) => {
      mockPrisma.delivery.count.mockResolvedValueOnce(count);
    });

    await expect(service.getDeliveryStats('company-1')).resolves.toEqual([
      { status: 'pending', count: 1 },
      { status: 'assigned', count: 2 },
      { status: 'in_progress', count: 3 },
      { status: 'delivered', count: 4 },
      { status: 'failed', count: 5 },
      { status: 'cancelled', count: 6 },
    ]);
  });

  describe('getReliabilityScore', () => {
    it('calculates on-time score and downward trend', async () => {
      mockPrisma.delivery.findMany
        .mockResolvedValueOnce([
          {
            status: 'delivered',
            completedAt: new Date('2026-07-20T09:00:00.000Z'),
            scheduledDate: new Date('2026-07-20T10:00:00.000Z'),
          },
          {
            status: 'delivered',
            completedAt: new Date('2026-07-20T12:00:00.000Z'),
            scheduledDate: new Date('2026-07-20T10:00:00.000Z'),
          },
          {
            status: 'failed',
            completedAt: new Date('2026-07-20T12:00:00.000Z'),
            scheduledDate: new Date('2026-07-20T10:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([
          {
            status: 'delivered',
            completedAt: new Date('2026-06-20T09:00:00.000Z'),
            scheduledDate: new Date('2026-06-20T10:00:00.000Z'),
          },
        ]);

      await expect(service.getReliabilityScore('company-1')).resolves.toEqual({
        score: 50,
        trend: 'down',
        onTime: 1,
        total: 2,
      });
    });

    it('defaults to a perfect stable score when there are no deliveries', async () => {
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await expect(service.getReliabilityScore('company-1')).resolves.toEqual({
        score: 100,
        trend: 'stable',
        onTime: 0,
        total: 0,
      });
    });
  });

  it('formats fuel logs for chart consumption series', async () => {
    mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
      {
        fillDate: new Date('2026-07-21T08:30:00.000Z'),
        liters: 40,
        kilometers: 400,
        vehicle: { licensePlate: 'TRK-001' },
        anomalyFlag: false,
      },
      {
        fillDate: new Date('2026-07-22T08:30:00.000Z'),
        liters: 10,
        kilometers: 0,
        vehicle: { licensePlate: 'TRK-002' },
        anomalyFlag: true,
      },
    ]);

    await expect(service.getFuelStatsForChart('company-1')).resolves.toEqual([
      {
        date: '2026-07-21',
        liters: 40,
        kilometers: 400,
        consumption: 10,
        vehicle: 'TRK-001',
        anomaly: false,
      },
      {
        date: '2026-07-22',
        liters: 10,
        kilometers: 0,
        consumption: 0,
        vehicle: 'TRK-002',
        anomaly: true,
      },
    ]);
  });
});
