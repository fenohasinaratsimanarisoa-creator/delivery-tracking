import { FuelAnalysisProcessor } from './fuel-analysis.processor';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { FuelConsumptionService } from '../modules/fuel-consumption/fuel-consumption.service';

const mockPrisma = {
  fuelLog: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  companyFuelSettings: {
    findUnique: jest.fn(),
  },
};

const mockNotifications = {
  create: jest.fn(),
};

const mockFuelConsumption = {
  generateDailyReportForSingleDriver: jest.fn().mockResolvedValue(undefined),
};

describe('FuelAnalysisProcessor', () => {
  let processor: FuelAnalysisProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new FuelAnalysisProcessor(
      mockPrisma as unknown as PrismaService,
      mockNotifications as unknown as NotificationsService,
      mockFuelConsumption as unknown as FuelConsumptionService,
    );
  });

  it('handles recompute-driver-report by recomputing ONLY the target driver (with date)', async () => {
    const job = {
      name: 'recompute-driver-report',
      data: { companyId: 'comp-1', driverId: 'driver-1', date: '2026-07-20T12:00:00.000Z' },
    } as any;

    await processor.process(job);

    expect(mockFuelConsumption.generateDailyReportForSingleDriver).toHaveBeenCalledWith(
      'comp-1',
      'driver-1',
      new Date('2026-07-20T12:00:00.000Z'),
    );
    // Ne touche jamais au flux 'analyze'
    expect(mockPrisma.fuelLog.findFirst).not.toHaveBeenCalled();
  });

  it('handles recompute-driver-report without a date (defaults to today)', async () => {
    const job = {
      name: 'recompute-driver-report',
      data: { companyId: 'comp-1', driverId: 'driver-1' },
    } as any;

    await processor.process(job);

    expect(mockFuelConsumption.generateDailyReportForSingleDriver).toHaveBeenCalledWith(
      'comp-1',
      'driver-1',
      undefined,
    );
  });

  it('preserves the existing analyze job path untouched', async () => {
    mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
      id: 'log-1',
      liters: 50,
      kilometers: 100,
      anomalyFlag: false,
      anomalyReason: null,
      vehicle: { licensePlate: 'TRK-1', theoreticalConsumption: 10 },
    });
    mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce({ anomalyThreshold: 20 });
    mockPrisma.fuelLog.update.mockResolvedValueOnce({});

    const job = {
      name: 'analyze',
      data: { fuelLogId: 'log-1', vehicleId: 'veh-1', companyId: 'comp-1' },
    } as any;

    await processor.process(job);

    expect(mockPrisma.fuelLog.update).toHaveBeenCalled();
    expect(mockFuelConsumption.generateDailyReportForSingleDriver).not.toHaveBeenCalled();
  });
});
