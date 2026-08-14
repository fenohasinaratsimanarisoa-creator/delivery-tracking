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
    it('calculates on-time score and downward trend, échecs INCLUS au dénominateur', async () => {
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
            completedAt: null,
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

      // 3 terminées (dont 1 failed) → 1 à temps → 33 %. AVANT le correctif, le failed
      // (completedAt null) était exclu → 50 % et le score ne pénalisait jamais les échecs.
      await expect(service.getReliabilityScore('company-1')).resolves.toEqual({
        score: 33,
        trend: 'down',
        onTime: 1,
        total: 3,
      });
      // La fenêtre est calculée sur createdAt (toujours renseigné), pas completedAt.
      const currentQuery = mockPrisma.delivery.findMany.mock.calls[0][0];
      expect(currentQuery.where.createdAt).toBeDefined();
      expect(currentQuery.where.completedAt).toBeUndefined();
    });

    it('exclut les cancelled de la requête (hors périmètre fiabilité)', async () => {
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.getReliabilityScore('company-1');
      const currentQuery = mockPrisma.delivery.findMany.mock.calls[0][0];
      expect(currentQuery.where.status).toEqual({ in: ['delivered', 'failed'] });
    });

    it('100% quand TOUT échoue (les échecs comptent contre le score)', async () => {
      mockPrisma.delivery.findMany
        .mockResolvedValueOnce([
          { status: 'failed', completedAt: null, scheduledDate: null },
          { status: 'failed', completedAt: null, scheduledDate: null },
        ])
        .mockResolvedValueOnce([]);

      await expect(service.getReliabilityScore('company-1')).resolves.toEqual({
        score: 0,
        trend: 'stable',
        onTime: 0,
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
        consumptionAnomalyFlag: false,
        gpsAnomalyFlag: false,
      },
      {
        fillDate: new Date('2026-07-22T08:30:00.000Z'),
        liters: 10,
        kilometers: 0,
        vehicle: { licensePlate: 'TRK-002' },
        consumptionAnomalyFlag: false,
        gpsAnomalyFlag: true,
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
