import { FuelAnalysisProcessor } from './fuel-analysis.processor';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { FuelConsumptionService } from '../modules/fuel-consumption/fuel-consumption.service';
import { ConfigService } from '@nestjs/config';

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

  it('writes ONLY the consumption anomaly pair from the analyze job (never the GPS pair, never the legacy flag)', async () => {
    mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
      id: 'log-1',
      liters: 50,
      kilometers: 100,
      consumptionAnomalyFlag: false,
      consumptionAnomalyReason: null,
      gpsAnomalyFlag: true,
      gpsAnomalyReason: 'Distance saisie (999km) très supérieure à la distance GPS (10.0km)',
      vehicle: { licensePlate: 'TRK-1', theoreticalConsumption: 10 },
    });
    mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce({ anomalyThreshold: 20 });
    mockPrisma.fuelLog.update.mockResolvedValueOnce({});

    const job = {
      name: 'analyze',
      data: { fuelLogId: 'log-1', vehicleId: 'veh-1', companyId: 'comp-1' },
    } as any;

    await processor.process(job);

    // 50L/100km vs 10 théorique → déviation 400% > 20% → anomalie consommation
    expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: expect.objectContaining({
        calculatedConsumption: 50,
        consumptionAnomalyFlag: true,
        consumptionAnomalyReason: expect.stringContaining('400.0'),
      }),
    });
    // Le job ne doit JAMAIS toucher aux champs GPS ni aux champs legacy.
    const updateData = mockPrisma.fuelLog.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('gpsAnomalyFlag');
    expect(updateData).not.toHaveProperty('gpsAnomalyReason');
    expect(updateData).not.toHaveProperty('anomalyFlag');
    expect(updateData).not.toHaveProperty('anomalyReason');
    expect(mockFuelConsumption.generateDailyReportForSingleDriver).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------
  // RÉGRESSION — write-loss entre les deux détecteurs d'anomalie carburant.
  // Chaque détecteur écrit SA propre paire de champs. Quel que soit l'ordre
  // d'exécution, les deux anomalies doivent rester visibles (flag + raison).
  // ----------------------------------------------------------------
  describe('anomaly write-loss regression (processFuelLogAnalysis + crossCheckFuelLogWithGps)', () => {
    let store: Record<string, any>;
    let service: FuelConsumptionService;
    let regressionPrisma: any;
    const regressionNotifications = { create: jest.fn() };
    const regressionConfig = { get: jest.fn(() => 25) };
    const regressionGateway = { broadcastDataUpdate: jest.fn() };

    beforeEach(() => {
      jest.clearAllMocks();
      store = {
        // Ce fuel log déclenche les DEUX détecteurs :
        //  - consommation : 50L/100km vs 8 théorique → déviation 525% > 20%
        //  - GPS : 100km saisis vs 30km GPS → ratio 3.33 > 3
        'log-1': {
          id: 'log-1',
          liters: 50,
          kilometers: 100,
          fillDate: new Date('2026-07-20T00:00:00.000Z'),
          vehicleId: 'vehicle-1',
          companyId: 'comp-1',
          vehicle: { licensePlate: 'TRK-1', theoreticalConsumption: 8 },
          consumptionAnomalyFlag: false,
          consumptionAnomalyReason: null,
          gpsAnomalyFlag: false,
          gpsAnomalyReason: null,
        },
      };

      regressionPrisma = {
        fuelLog: {
          // Renvoie le log depuis un store partagé (simule une vraie base) :
          // findFirst(id) pour le job d'analyse, findFirst(sans id) pour le
          // look-up du plein précédent → null (période = 30 jours).
          findFirst: jest.fn(async (args: any) => store[args?.where?.id] || null),
          update: jest.fn(async (args: any) => {
            store[args.where.id] = { ...store[args.where.id], ...args.data };
            return store[args.where.id];
          }),
        },
        dailyFuelReport: {
          aggregate: jest.fn(async () => ({ _sum: { distanceKm: 30 } })),
        },
        companyFuelSettings: {
          findUnique: jest.fn(async () => ({ anomalyThreshold: 20 })),
        },
      };

      service = new FuelConsumptionService(
        regressionPrisma as unknown as PrismaService,
        regressionConfig as unknown as ConfigService,
        regressionNotifications as unknown as NotificationsService,
        undefined as any,
        regressionGateway as any,
      );
      processor = new FuelAnalysisProcessor(
        regressionPrisma as unknown as PrismaService,
        regressionNotifications as unknown as NotificationsService,
        service,
      );
    });

    const runAnalysis = () =>
      processor.process({
        name: 'analyze',
        data: { fuelLogId: 'log-1', vehicleId: 'vehicle-1', companyId: 'comp-1' },
      } as any);

    const runCrossCheck = () =>
      (service as any).crossCheckFuelLogWithGps(store['log-1'], 'comp-1');

    const expectBothAnomaliesVisible = () => {
      const log = store['log-1'];
      expect(log.consumptionAnomalyFlag).toBe(true);
      expect(log.consumptionAnomalyReason).toContain('525.0');
      expect(log.gpsAnomalyFlag).toBe(true);
      expect(log.gpsAnomalyReason).toContain('Distance saisie');
      // Le champ dérivé reste consistant en lecture (consumption OR gps).
      expect(log.consumptionAnomalyFlag || log.gpsAnomalyFlag).toBe(true);
    };

    it('processFuelLogAnalysis PUIS crossCheckFuelLogWithGps : les deux anomalies restent visibles', async () => {
      await runAnalysis();
      await runCrossCheck();
      expectBothAnomaliesVisible();
    });

    it('crossCheckFuelLogWithGps PUIS processFuelLogAnalysis : les deux anomalies restent visibles', async () => {
      await runCrossCheck();
      await runAnalysis();
      expectBothAnomaliesVisible();
    });

    it('une analyse consommation NON anormale n’efface plus une anomalie GPS préalablement posée', async () => {
      // Log où le détecteur consommation ne doit PAS flagger (0% de déviation)
      // mais où le détecteur GPS flagge (ratio 3.33 > 3). AVANT la correction,
      // l'analyse (job) écrasait anomalyFlag=false et perdait l'anomalie GPS.
      store['log-1'] = {
        ...store['log-1'],
        liters: 50,
        kilometers: 100,
        vehicle: { licensePlate: 'TRK-1', theoreticalConsumption: 50 },
      };

      await runCrossCheck();
      await runAnalysis();

      expect(store['log-1'].gpsAnomalyFlag).toBe(true);
      expect(store['log-1'].gpsAnomalyReason).toContain('Distance saisie');
      expect(store['log-1'].consumptionAnomalyFlag).toBe(false);
      expect(store['log-1'].consumptionAnomalyReason).toBeNull();
      expect(store['log-1'].consumptionAnomalyFlag || store['log-1'].gpsAnomalyFlag).toBe(true);
    });
  });
});
