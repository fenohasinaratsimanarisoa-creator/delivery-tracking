import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationPriority, NotificationType, GpsDataQuality } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FuelConsumptionService } from './fuel-consumption.service';

const mockQueue = {
  add: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  vehicle: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  fuelLog: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  fuelPriceHistory: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
  companyFuelSettings: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
  },
  dailyFuelReport: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  driver: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
  gpsPosition: {
    findMany: jest.fn(),
  },
};

const mockConfigService = {
  get: jest.fn(),
};

const mockNotifications = {
  create: jest.fn(),
};

const mockTrackingGateway = {
  broadcastDataUpdate: jest.fn(),
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
      mockTrackingGateway as any,
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

      await expect(service.create('company-a', dto)).rejects.toThrow(NotFoundException);

      expect(mockPrisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: { id: 'vehicle-other-company', companyId: 'company-a', deletedAt: null },
      });
    });

    it('accepts a vehicle that belongs to the company', async () => {
      const created = { id: 'fuel-ok', vehicleId: 'vehicle-1' };
      const enriched = { ...created, vehicle: { licensePlate: 'TRK-001' } };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
      });
      mockPrisma.fuelLog.create.mockResolvedValueOnce(created);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await expect(
        service.create('company-1', {
          liters: 60,
          kilometers: 500,
          cost: 120,
          fillDate: '2026-07-21T00:00:00.000Z',
          vehicleId: 'vehicle-1',
          notes: 'Full tank',
        }),
      ).resolves.toEqual({
        ...enriched,
        anomalyFlag: false,
        anomalyReason: null,
      });
    });
  });

  // ----------------------------------------------------------------
  // BUG 2 : Fuel price history broken — getFuelPriceForDate()
  // ----------------------------------------------------------------
  describe('BUG 2 — getFuelPriceForDate historical price lookup', () => {
    it('returns the old price when the date falls in its effective window (even if a newer open price exists)', async () => {
      const oldPrice = { pricePerLiter: 4500 };
      const newPrice = { pricePerLiter: 5200 };

      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(oldPrice);

      const result = await (service as any).getFuelPriceForDate(
        'company-1',
        'gasoil',
        new Date('2026-05-15'),
      );

      expect(result).toBe(4500);
      expect(mockPrisma.fuelPriceHistory.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          fuelType: 'gasoil',
          effectiveFrom: { lte: new Date('2026-05-15') },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: new Date('2026-05-15') } }],
        },
        orderBy: { effectiveFrom: 'desc' },
      });
    });

    it('falls back to default when no price matches', async () => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);
      mockPrisma.companyFuelSettings.upsert.mockResolvedValueOnce({ defaultFuelPrices: null });

      const result = await (service as any).getFuelPriceForDate(
        'company-1',
        'essence',
        new Date('2025-01-01'),
      );

      expect(result).toBe(5000);
      expect(mockPrisma.companyFuelSettings.upsert).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        update: {},
        create: expect.objectContaining({ companyId: 'company-1' }),
      });
    });

    it('prefers the most recent effectiveFrom price that covers the date', async () => {
      const newerPrice = { pricePerLiter: 5300 };
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(newerPrice);

      const result = await (service as any).getFuelPriceForDate(
        'company-1',
        'diesel',
        new Date('2026-07-20'),
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

    it('includes the full day of a mid-day previous fill (14h30) — no false anomaly', async () => {
      // Scénario du bug : plein précédent à 14h30 le jour J, dailyFuelReport du jour J
      // stocké à minuit UTC (reportDate). AVANT correction, la période gte=07-15T14:30Z
      // excluait le reportDate du jour J (minuit, antérieur à 14h30) → gpsKm sous-estimé
      // (seuls jours 16+17 comptés) → ratio > seuil → FAUSSE anomalie.
      // APRÈS correction, les bornes sont tronquées au jour UTC : le jour J est inclus.
      const fuelLog = {
        id: 'fuel-log-midday',
        vehicleId: 'vehicle-a',
        kilometers: 400,
        fillDate: new Date('2026-07-18T09:00:00.000Z'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-15T14:30:00.000Z'),
      });
      // Somme post-correction : jours 15 (200km) + 16 (50km) + 17 (50km) = 300km
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 300 },
      });
      // Seuil explicitement configuré à 3 pour isoler la logique des bornes de date
      // (la normalisation du jour entier) de la logique de seuil, testée séparément.
      mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce({
        crossCheckThreshold: 3,
      });

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          vehicleId: 'vehicle-a',
          reportDate: {
            gte: new Date('2026-07-15T00:00:00.000Z'),
            lte: new Date('2026-07-18T00:00:00.000Z'),
          },
        },
        _sum: { distanceKm: true },
      });
      // ratio = 400/300 = 1.33 < 3 (seuil configuré ici) → aucun flag d'anomalie
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalled();
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it('uses the CONFIGURABLE crossCheckThreshold (CompanyFuelSettings, défaut 1.3) au lieu du seuil en dur de 3', async () => {
      const fuelLog = {
        id: 'fuel-log-threshold',
        vehicleId: 'vehicle-a',
        kilometers: 200,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-15'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 100 },
      });
      // ratio = 200/100 = 2 : INVISIBLE avec l'ancien seuil de 3 (300%), visible à 1.3.
      mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce({
        crossCheckThreshold: 1.3,
      });

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      // 2 > 1.3 → anomalie détectée (avant la migration, 2 < 3 → aucun flag : jusqu'à
      // 2.9x de survalorisation passaient silencieusement).
      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-log-threshold' },
        data: expect.objectContaining({
          gpsAnomalyFlag: true,
          gpsAnomalyReason: expect.stringContaining('Distance saisie (200km)'),
        }),
      });
      expect(mockNotifications.create).toHaveBeenCalled();
    });

    it('falls back to the DEFAULT threshold 1.3 when CompanyFuelSettings has no crossCheckThreshold', async () => {
      const fuelLog = {
        id: 'fuel-log-default-threshold',
        vehicleId: 'vehicle-a',
        kilometers: 200,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-15'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 100 },
      });
      // Pas de ligne companyFuelSettings (ou champ null) → défaut 1.3.
      mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce(null);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fuel-log-default-threshold' },
          data: expect.objectContaining({ gpsAnomalyFlag: true }),
        }),
      );
    });

    it('writes ONLY the gps anomaly pair when the manual km is >3x the GPS distance', async () => {
      const fuelLog = {
        id: 'fuel-log-gps',
        vehicleId: 'vehicle-a',
        kilometers: 400,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-A' },
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({
        fillDate: new Date('2026-07-15'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({
        _sum: { distanceKm: 100 },
      });

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      // Le détecteur GPS ne doit JAMAIS écrire les champs consommation ni les
      // champs legacy anomalyFlag/anomalyReason (sinon write-loss).
      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-log-gps' },
        data: {
          gpsAnomalyFlag: true,
          gpsAnomalyReason: expect.stringContaining('Distance saisie (400km)'),
        },
      });
      const updateData = mockPrisma.fuelLog.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('consumptionAnomalyFlag');
      expect(updateData).not.toHaveProperty('consumptionAnomalyReason');
      expect(updateData).not.toHaveProperty('anomalyFlag');
      expect(updateData).not.toHaveProperty('anomalyReason');
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
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
      });
      mockPrisma.fuelLog.create.mockResolvedValueOnce(created);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await expect(service.create('company-1', dto)).resolves.toEqual({
        ...enriched,
        anomalyFlag: false,
        anomalyReason: null,
      });
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
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-2',
        companyId: 'company-1',
      });
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
      data: [{ id: 'fuel-1', anomalyFlag: false, anomalyReason: null }],
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
      consumptionAnomalyFlag: true,
      consumptionAnomalyReason: 'Consumption 30.00 L/100km deviates from theoretical',
      gpsAnomalyFlag: false,
      gpsAnomalyReason: null,
    };
    mockPrisma.fuelLog.findMany.mockResolvedValueOnce([
      {
        id: 'fuel-1',
        liters: 50,
        kilometers: 500,
        cost: 100,
        consumptionAnomalyFlag: false,
        gpsAnomalyFlag: false,
      },
      anomaly,
    ]);

    await expect(service.getConsumptionStats('company-1', 'vehicle-1')).resolves.toEqual({
      totalLiters: 80,
      totalKilometers: 600,
      totalCost: 180,
      averageConsumption: (80 / 600) * 100,
      anomalyCount: 1,
      anomalies: [
        {
          ...anomaly,
          anomalyFlag: true,
          anomalyReason: 'Consumption 30.00 L/100km deviates from theoretical',
        },
      ],
      logCount: 2,
    });
  });

  // ----------------------------------------------------------------
  // UPDATE — new PATCH :id
  // ----------------------------------------------------------------
  describe('update', () => {
    const existing = {
      id: 'fuel-1',
      liters: 50,
      kilometers: 500,
      cost: 100,
      fillDate: new Date('2026-07-21T00:00:00.000Z'),
      vehicleId: 'vehicle-1',
      companyId: 'company-1',
      consumptionAnomalyFlag: false,
      consumptionAnomalyReason: null,
      gpsAnomalyFlag: false,
      gpsAnomalyReason: null,
      notes: 'Full tank',
    };

    it('updates a fuel log that belongs to the company (notes only, no cross-check re-run)', async () => {
      const updated = { ...existing, notes: 'Corrected note' };
      const enriched = {
        ...updated,
        vehicle: { id: 'vehicle-1', brand: 'X', model: 'Y', licensePlate: 'TRK-001' },
      };

      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.fuelLog.update.mockResolvedValueOnce(updated);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await expect(
        service.update('company-1', 'fuel-1', { notes: 'Corrected note' }),
      ).resolves.toEqual({
        ...enriched,
        anomalyFlag: false,
        anomalyReason: null,
      });

      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-1' },
        data: { notes: 'Corrected note' },
        include: { vehicle: true },
      });
      // Aucun champ mesuré changé : ni le cross-check ni le job 'analyze' ne sont relancés.
      expect(mockPrisma.dailyFuelReport.aggregate).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws NotFound when the fuel log belongs to another company', async () => {
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('company-a', 'fuel-other-company', { liters: 60 }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalled();
    });

    it('throws NotFound when updating to a vehicle that belongs to another company', async () => {
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('company-1', 'fuel-1', { vehicleId: 'vehicle-other-company' }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.vehicle.findFirst).toHaveBeenCalledWith({
        where: { id: 'vehicle-other-company', companyId: 'company-1', deletedAt: null },
      });
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalled();
    });

    it('resets a stale anomaly flag (both pairs) and re-runs the GPS cross-check when measured fields change', async () => {
      const flagged = {
        ...existing,
        consumptionAnomalyFlag: true,
        consumptionAnomalyReason: 'Old consumption anomaly',
        gpsAnomalyFlag: true,
        gpsAnomalyReason: 'Old GPS anomaly',
      };
      const corrected = {
        ...flagged,
        kilometers: 120,
        consumptionAnomalyFlag: false,
        consumptionAnomalyReason: null,
        gpsAnomalyFlag: false,
        gpsAnomalyReason: null,
      };
      const enriched = {
        ...corrected,
        vehicle: { id: 'vehicle-1', brand: 'X', model: 'Y', licensePlate: 'TRK-001' },
      };

      // findOne() puis look-up du plein précédent dans crossCheckFuelLogWithGps()
      mockPrisma.fuelLog.findFirst
        .mockResolvedValueOnce(flagged)
        .mockResolvedValueOnce({ fillDate: new Date('2026-07-10T00:00:00.000Z') });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 0 } });
      mockPrisma.fuelLog.update.mockResolvedValueOnce(corrected);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await service.update('company-1', 'fuel-1', { kilometers: 120 });

      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-1' },
        data: {
          kilometers: 120,
          consumptionAnomalyFlag: false,
          consumptionAnomalyReason: null,
          gpsAnomalyFlag: false,
          gpsAnomalyReason: null,
        },
        include: { vehicle: true },
      });
      // Le cross-check a été relancé après la correction de saisie.
      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalled();
    });

    it('re-dispatches the analyze job when measured fields change (recompute calculatedConsumption)', async () => {
      const stale = { ...existing, calculatedConsumption: 10 };
      const updated = {
        ...stale,
        kilometers: 120,
        consumptionAnomalyFlag: false,
        consumptionAnomalyReason: null,
        gpsAnomalyFlag: false,
        gpsAnomalyReason: null,
      };
      const enriched = {
        ...updated,
        vehicle: { id: 'vehicle-1', brand: 'X', model: 'Y', licensePlate: 'TRK-001' },
      };

      mockPrisma.fuelLog.findFirst
        .mockResolvedValueOnce(stale)
        .mockResolvedValueOnce({ fillDate: new Date('2026-07-10T00:00:00.000Z') });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 0 } });
      mockPrisma.fuelLog.update.mockResolvedValueOnce(updated);
      mockPrisma.fuelLog.findUnique.mockResolvedValueOnce(enriched);

      await service.update('company-1', 'fuel-1', { kilometers: 120 });

      // Même payload que dans create() : un nouveau job 'analyze' recalcule
      // calculatedConsumption à partir des valeurs corrigées.
      expect(mockQueue.add).toHaveBeenCalledWith('analyze', {
        fuelLogId: 'fuel-1',
        vehicleId: 'vehicle-1',
        companyId: 'company-1',
      });
    });
  });

  // ----------------------------------------------------------------
  // REMOVE — new DELETE :id
  // ----------------------------------------------------------------
  describe('remove', () => {
    it('hard-deletes a fuel log that belongs to the company', async () => {
      const existing = {
        id: 'fuel-1',
        liters: 50,
        kilometers: 500,
        cost: 100,
        fillDate: new Date('2026-07-21T00:00:00.000Z'),
        vehicleId: 'vehicle-1',
        companyId: 'company-1',
      };
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(existing);
      mockPrisma.fuelLog.delete.mockResolvedValueOnce(existing);

      await expect(service.remove('company-1', 'fuel-1')).resolves.toEqual({
        message: 'Fuel log deleted',
      });

      expect(mockPrisma.fuelLog.delete).toHaveBeenCalledWith({ where: { id: 'fuel-1' } });
    });

    it('throws NotFound when the fuel log belongs to another company', async () => {
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('company-a', 'fuel-other-company')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockPrisma.fuelLog.delete).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // REAL-TIME DAILY FUEL REPORT — generateDailyReportForSingleDriver()
  // ----------------------------------------------------------------
  describe('generateDailyReportForSingleDriver', () => {
    const TARGET_DATE = new Date('2026-07-20T12:00:00.000Z');
    const driver = {
      id: 'driver-1',
      firstName: 'Jean',
      lastName: 'Rakoto',
    };
    const VEHICLE_V1 = {
      id: 'vehicle-1',
      licensePlate: 'TRK-001',
      fuelType: 'Diesel',
      theoreticalConsumption: 10,
    };
    // 4 points : le 2e est du bruit GPS (< 5m depuis le 1er, doit être ignoré), puis
    // deux segments ~1111.95m → distanceKm = 2.22.
    const POSITIONS = [
      { latitude: 0, longitude: 0, vehicleId: 'vehicle-1' },
      { latitude: 0, longitude: 0.00004, vehicleId: 'vehicle-1' },
      { latitude: 0, longitude: 0.01004, vehicleId: 'vehicle-1' },
      { latitude: 0, longitude: 0.02004, vehicleId: 'vehicle-1' },
    ];
    const expectedUpsertPayload = {
      where: {
        driverId_vehicleId_reportDate: {
          driverId: 'driver-1',
          vehicleId: 'vehicle-1',
          reportDate: new Date('2026-07-20T00:00:00.000Z'),
        },
      },
      create: {
        reportDate: new Date('2026-07-20T00:00:00.000Z'),
        driverId: 'driver-1',
        driverName: 'Jean Rakoto',
        vehicleId: 'vehicle-1',
        vehiclePlate: 'TRK-001',
        fuelType: 'diesel',
        distanceKm: 2.22,
        gpsDataQuality: GpsDataQuality.sufficient,
        consumptionLPer100Km: 10,
        estimatedCost: 1087.8,
        pricePerLiterUsed: 4900,
        companyId: 'company-1',
      },
      update: {
        distanceKm: 2.22,
        gpsDataQuality: GpsDataQuality.sufficient,
        estimatedCost: 1087.8,
        fuelType: 'diesel',
        consumptionLPer100Km: 10,
        vehiclePlate: 'TRK-001',
        pricePerLiterUsed: 4900,
      },
    };

    beforeEach(() => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 4900 });
      mockPrisma.gpsPosition.findMany.mockResolvedValue(POSITIONS);
      mockPrisma.vehicle.findUnique.mockResolvedValue(VEHICLE_V1);
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => args);
    });

    it('computes and upserts the report for the target driver ONLY (never scans the whole company)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({
        where: { id: 'driver-1', companyId: 'company-1', deletedAt: null },
        select: expect.anything(),
      });
      // Le chemin temps réel ne doit PAS boucler sur toute la company.
      expect(mockPrisma.driver.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledWith(expectedUpsertPayload);
    });

    it('produces an IDENTICAL report to generateDailyReportForCompany for that same driver', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.driver.findMany.mockResolvedValue([driver]);

      // 1) Via le flux temps réel (un seul chauffeur)
      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);
      // 2) Via le batch quotidien (toute la company, le cron de 22h)
      await (service as any).generateDailyReportForCompany('company-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(2);
      const singleDriverPayload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0];
      const companyPayload = mockPrisma.dailyFuelReport.upsert.mock.calls[1][0];
      // Le calcul (et donc l'upsert) doit être strictement identique.
      expect(singleDriverPayload).toEqual(companyPayload);
    });

    it('handles two near-simultaneous completions via a full-day recompute (no distance double-count)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);

      // Deux livraisons du même chauffeur se terminent presque en même temps → deux jobs.
      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);
      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(2);
      // Chaque appel recalcule la TOTALITÉ du jour (2.22 km) et non un incrément :
      // l'upsert écrasé par le dernier job garde une distance correcte, jamais doublée.
      const first = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
      const second = mockPrisma.dailyFuelReport.upsert.mock.calls[1][0] as any;
      expect(first.create.distanceKm).toBe(2.22);
      expect(second.create.distanceKm).toBe(2.22);
      expect(first.create.distanceKm).toBe(second.create.distanceKm);
    });

    it('does nothing when the driver is not in the company', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-999', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.gpsPosition.findMany).not.toHaveBeenCalled();
    });

    it('creates an insufficient report (distanceKm=0) when the driver has fewer than 2 GPS positions', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.gpsPosition.findMany.mockResolvedValue([POSITIONS[0]]);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
      const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
      expect(payload.create.distanceKm).toBe(0);
      expect(payload.create.gpsDataQuality).toBe(GpsDataQuality.insufficient);
      expect(payload.create.vehicleId).toBe('vehicle-1');
    });

    it('creates NO report when there is NO GPS data (0 positions → no vehicle group to attribute)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.gpsPosition.findMany.mockResolvedValue([]);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      console.log(
        `[0 positions] upsert appelé : ${mockPrisma.dailyFuelReport.upsert.mock.calls.length} fois`,
      );
      // Aucun vehicleId réellement présent dans les positions → aucun groupe → aucun rapport.
      expect(mockPrisma.dailyFuelReport.upsert).not.toHaveBeenCalled();
      expect(mockTrackingGateway.broadcastDataUpdate).not.toHaveBeenCalled();
    });

    it('does nothing when the driver has no GPS positions for the day (no vehicle group to attribute)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.gpsPosition.findMany.mockResolvedValue([]);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).not.toHaveBeenCalled();
      expect(mockTrackingGateway.broadcastDataUpdate).not.toHaveBeenCalled();
    });

    it('broadcasts a fuelReport dataUpdate to the company AFTER the upsert, with driverId and reportDate', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
      expect(mockTrackingGateway.broadcastDataUpdate).toHaveBeenCalledTimes(1);
      expect(mockTrackingGateway.broadcastDataUpdate).toHaveBeenCalledWith(
        'company-1',
        'fuelReport',
        expect.objectContaining({
          entity: 'fuelReport',
          driverId: 'driver-1',
          reportDate: new Date('2026-07-20T00:00:00.000Z').toISOString(),
        }),
      );
      // L'événement est diffusé APRÈS l'écriture en base, jamais avant.
      const upsertCall = mockPrisma.dailyFuelReport.upsert.mock.invocationCallOrder[0];
      const broadcastCall = mockTrackingGateway.broadcastDataUpdate.mock.invocationCallOrder[0];
      expect(upsertCall).toBeLessThan(broadcastCall);
    });

    it('does NOT broadcast when the upsert fails (event only fires after a successful write)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.dailyFuelReport.upsert.mockRejectedValue(new Error('DB down'));

      await expect(
        service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE),
      ).rejects.toThrow('DB down');

      expect(mockTrackingGateway.broadcastDataUpdate).not.toHaveBeenCalled();
    });

    it('broadcasts a fuelReport dataUpdate even when GPS data is insufficient (report still created)', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.gpsPosition.findMany.mockResolvedValue([POSITIONS[0]]);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      // Le rapport est créé (distanceKm=0) → l'événement est diffusé, jamais avant.
      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
      expect(mockTrackingGateway.broadcastDataUpdate).toHaveBeenCalledTimes(1);
      const upsertCall = mockPrisma.dailyFuelReport.upsert.mock.invocationCallOrder[0];
      const broadcastCall = mockTrackingGateway.broadcastDataUpdate.mock.invocationCallOrder[0];
      expect(upsertCall).toBeLessThan(broadcastCall);
    });
  });

  // ----------------------------------------------------------------
  // BUG RACINE : changement de véhicule en cours de journée (V1 matin → V2 après-midi)
  // ----------------------------------------------------------------
  describe('generateDailyReportForSingleDriver — changement de véhicule en cours de journée', () => {
    const TARGET_DATE = new Date('2026-07-20T12:00:00.000Z');
    const driver = { id: 'driver-1', firstName: 'Jean', lastName: 'Rakoto' };
    const V1 = {
      id: 'vehicle-1',
      licensePlate: 'TRK-001',
      fuelType: 'Diesel',
      theoreticalConsumption: 10,
    };
    const V2 = {
      id: 'vehicle-2',
      licensePlate: 'TRK-002',
      fuelType: 'Essence',
      theoreticalConsumption: 6,
    };

    beforeEach(() => {
      mockPrisma.driver.findFirst.mockResolvedValue(driver);
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 4900 });
      mockPrisma.vehicle.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.findUnique.mockImplementation(async ({ where }: any) =>
        where.id === V1.id ? V1 : V2,
      );
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => args);
    });

    it('produit DEUX DailyFuelReport distincts (un par vehicleId), chacun avec les km ET les caractéristiques du BON véhicule', async () => {
      // Matin sur V1 : 2 segments ~1111.95m → 2.22 km. Après-midi sur V2 : 1 segment → 1.11 km.
      mockPrisma.gpsPosition.findMany.mockResolvedValue([
        { latitude: 0, longitude: 0, vehicleId: 'vehicle-1' },
        { latitude: 0, longitude: 0.01004, vehicleId: 'vehicle-1' },
        { latitude: 0, longitude: 0.02004, vehicleId: 'vehicle-1' },
        { latitude: 0, longitude: 0.02004, vehicleId: 'vehicle-2' },
        { latitude: 0, longitude: 0.03004, vehicleId: 'vehicle-2' },
      ]);

      await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(2);
      const upserts = mockPrisma.dailyFuelReport.upsert.mock.calls.map((c: any) => c[0]);
      const vehicleKeys = upserts.map((u: any) => u.where.driverId_vehicleId_reportDate.vehicleId);
      expect(vehicleKeys.sort()).toEqual(['vehicle-1', 'vehicle-2']);

      const reportV1 = upserts.find((u: any) => u.create.vehicleId === 'vehicle-1');
      const reportV2 = upserts.find((u: any) => u.create.vehicleId === 'vehicle-2');
      expect(reportV1).toBeDefined();
      expect(reportV2).toBeDefined();

      // distanceKm du BON groupe de positions (V1 matin / V2 après-midi)
      expect(reportV1.create.distanceKm).toBeCloseTo(2.23, 1);
      expect(reportV2.create.distanceKm).toBeCloseTo(1.11, 1);

      // Caractéristiques du BON véhicule (jamais driver.vehicle — ici le driver n'a
      // d'ailleurs AUCUN véhicule courant, donc l'ancien code aurait planté/ignoré V2).
      expect(reportV1.create.fuelType).toBe('diesel');
      expect(reportV2.create.fuelType).toBe('essence');
      expect(reportV1.create.consumptionLPer100Km).toBe(10);
      expect(reportV2.create.consumptionLPer100Km).toBe(6);
      expect(reportV1.create.vehiclePlate).toBe('TRK-001');
      expect(reportV2.create.vehiclePlate).toBe('TRK-002');

      // estimatedCost avec la consommation/prix du bon véhicule (4900 le litre).
      expect(reportV1.create.estimatedCost).toBe(
        Math.round(((reportV1.create.distanceKm * 10) / 100) * 4900 * 100) / 100,
      );
      expect(reportV2.create.estimatedCost).toBe(
        Math.round(((reportV2.create.distanceKm * 6) / 100) * 4900 * 100) / 100,
      );
      // Les km de V1 ne sont PAS chiffrés avec les caractéristiques de V2.
      expect(reportV1.create.estimatedCost).not.toBe(reportV2.create.estimatedCost);
    });
  });

  // ----------------------------------------------------------------
  // Véhicule SANS chauffeur assigné → generateDailyReportForCompany
  // ----------------------------------------------------------------
  describe('generateDailyReportForCompany — véhicules actifs sans chauffeur assigné', () => {
    const TARGET_DATE = new Date('2026-07-20T12:00:00.000Z');

    beforeEach(() => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 4900 });
      mockPrisma.vehicle.findUnique.mockResolvedValue({
        id: 'vehicle-orphan',
        licensePlate: 'TRK-O',
        fuelType: 'Diesel',
        theoreticalConsumption: 10,
      });
      mockPrisma.driver.findUnique.mockResolvedValue({
        id: 'driver-x',
        firstName: 'X',
        lastName: 'Y',
      });
      mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => args);
    });

    it('crée un DailyFuelReport pour un véhicule sans chauffeur (gpsKm > 0) → cross-check détectable', async () => {
      // Aucun chauffeur actif : seule la boucle "véhicules sans chauffeur" tourne.
      mockPrisma.driver.findMany.mockResolvedValue([]);
      mockPrisma.vehicle.findMany.mockResolvedValue([{ id: 'vehicle-orphan' }]);
      // 2 positions sur ce véhicule (driverId quelconque) → ~1.11 km.
      mockPrisma.gpsPosition.findMany.mockResolvedValue([
        { latitude: 0, longitude: 0, driverId: 'driver-x' },
        { latitude: 0, longitude: 0.01004, driverId: 'driver-x' },
      ]);

      await (service as any).generateDailyReportForCompany('company-1', TARGET_DATE);

      // La boucle interroge bien les véhicules actifs SANS chauffeur.
      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1', deletedAt: null, isActive: true, driver: { is: null } },
        select: { id: true },
      });
      // Le rapport du véhicule orphelin est bien créé avec une distance GPS > 0.
      expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
      const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
      expect(payload.create.vehicleId).toBe('vehicle-orphan');
      expect(payload.create.distanceKm).toBeGreaterThan(0);

      // crossCheckFuelLogWithGps peut alors agréger gpsKm > 0 pour ce véhicule et détecter.
      mockPrisma.fuelLog.findFirst.mockResolvedValueOnce({ fillDate: new Date('2026-07-18') });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 1.11 } });
      const fuelLog = {
        id: 'fuel-orphan',
        vehicleId: 'vehicle-orphan',
        kilometers: 500,
        fillDate: new Date('2026-07-25'),
        vehicle: { licensePlate: 'TRK-O' },
      };
      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ vehicleId: 'vehicle-orphan' }),
        }),
      );
      // 500 / 1.11 ≈ 450 >> 1.3 → anomalie GPS flaggée (détection rendue possible).
      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fuel-orphan' },
          data: expect.objectContaining({ gpsAnomalyFlag: true }),
        }),
      );
    });
  });

  // ----------------------------------------------------------------
  // PRIX CARBURANT — modifiables et persistés (plus de prix en dur)
  // ----------------------------------------------------------------
  describe('fuel price management', () => {
    it('getFuelPrices returns editable defaults + history', async () => {
      mockPrisma.companyFuelSettings.findUnique.mockResolvedValueOnce({
        defaultFuelPrices: { diesel: 5200 },
      });
      mockPrisma.fuelPriceHistory.findMany.mockResolvedValueOnce([
        { id: 'fp-1', fuelType: 'diesel', pricePerLiter: 5200 },
      ]);

      const result = await service.getFuelPrices('company-1');

      expect(result.defaults).toEqual({ diesel: 5200 });
      expect(result.history).toHaveLength(1);
    });

    it('updateDefaultFuelPrices persists sanitized per-company defaults', async () => {
      mockPrisma.companyFuelSettings.upsert.mockResolvedValueOnce({});

      const result = await service.updateDefaultFuelPrices('company-1', {
        diesel: 5400,
        essence: 5200,
      });

      expect(result.defaults).toEqual({ diesel: 5400, essence: 5200 });
      expect(mockPrisma.companyFuelSettings.upsert).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        update: { defaultFuelPrices: { diesel: 5400, essence: 5200 } },
        create: { companyId: 'company-1', defaultFuelPrices: { diesel: 5400, essence: 5200 } },
      });
    });

    it('createFuelPrice closes the previous open-ended entry of the same fuel type', async () => {
      const effectiveFrom = new Date('2026-08-01T00:00:00.000Z');
      mockPrisma.fuelPriceHistory.updateMany.mockResolvedValueOnce({ count: 1 });
      // Aucun chevauchement avec une entrée déjà fermée → création autorisée.
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);
      mockPrisma.fuelPriceHistory.create.mockResolvedValueOnce({ id: 'fp-new' });

      await service.createFuelPrice('company-1', {
        fuelType: 'Diesel',
        pricePerLiter: 5300,
        effectiveFrom: '2026-08-01',
      });

      expect(mockPrisma.fuelPriceHistory.updateMany).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          fuelType: 'diesel',
          effectiveUntil: null,
          effectiveFrom: { lt: effectiveFrom },
        },
        data: { effectiveUntil: new Date(effectiveFrom.getTime() - 1) },
      });
      // La garde-fou anti-chevauchement interroge bien la même company/fuelType.
      expect(mockPrisma.fuelPriceHistory.findFirst).toHaveBeenCalledWith({
        where: {
          companyId: 'company-1',
          fuelType: 'diesel',
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: effectiveFrom } }],
        },
      });
      expect(mockPrisma.fuelPriceHistory.create).toHaveBeenCalledWith({
        data: { companyId: 'company-1', fuelType: 'diesel', pricePerLiter: 5300, effectiveFrom },
      });
    });

    it('rejects a price that overlaps an already-closed range with a 400', async () => {
      mockPrisma.fuelPriceHistory.updateMany.mockResolvedValueOnce({ count: 0 });
      // Entrée existante DÉJÀ FERMÉE : [2026-01-01 → 2026-01-15].
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce({
        id: 'fp-overlap',
        fuelType: 'diesel',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: new Date('2026-01-15T00:00:00.000Z'),
      });

      await expect(
        service.createFuelPrice('company-1', {
          fuelType: 'Diesel',
          pricePerLiter: 5300,
          effectiveFrom: '2026-01-10',
        }),
      ).rejects.toThrow(BadRequestException);

      // Rien n'est inséré : le chevauchement est refusé avant la création.
      expect(mockPrisma.fuelPriceHistory.create).not.toHaveBeenCalled();
    });

    it('rejects an open-ended price whose start falls inside a closed range (no create)', async () => {
      mockPrisma.fuelPriceHistory.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce({
        id: 'fp-overlap-2',
        fuelType: 'diesel',
        effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
        effectiveUntil: new Date('2026-02-28T00:00:00.000Z'),
      });

      let errorMessage = '';
      try {
        await service.createFuelPrice('company-1', {
          fuelType: 'diesel',
          pricePerLiter: 5200,
          effectiveFrom: '2026-02-15',
        });
      } catch (e: any) {
        errorMessage = e.message;
        console.log(
          `[overlap] plage existante fermée [2026-02-01 → 2026-02-28], nouveau prix à 2026-02-15 → ${e.constructor.name}: ${e.message}`,
        );
      }

      expect(errorMessage).toContain('overlaps');
      expect(errorMessage).toContain('2026-02-28');
      expect(mockPrisma.fuelPriceHistory.create).not.toHaveBeenCalled();
    });

    it('allows a price entirely AFTER a closed range (no overlap)', async () => {
      mockPrisma.fuelPriceHistory.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);
      mockPrisma.fuelPriceHistory.create.mockResolvedValueOnce({ id: 'fp-after' });

      await service.createFuelPrice('company-1', {
        fuelType: 'diesel',
        pricePerLiter: 5300,
        effectiveFrom: '2026-03-01',
      });

      expect(mockPrisma.fuelPriceHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ effectiveFrom: new Date('2026-03-01T00:00:00.000Z') }),
      });
    });

    it('updateFuelPrice throws NotFound when the price belongs to another company', async () => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.updateFuelPrice('company-a', 'fp-other', { pricePerLiter: 1 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.fuelPriceHistory.update).not.toHaveBeenCalled();
    });

    it('deleteFuelPrice throws NotFound when the price belongs to another company', async () => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce(null);

      await expect(service.deleteFuelPrice('company-a', 'fp-other')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.fuelPriceHistory.delete).not.toHaveBeenCalled();
    });

    it('deleteFuelPrice deletes a price that belongs to the company', async () => {
      mockPrisma.fuelPriceHistory.findFirst.mockResolvedValueOnce({
        id: 'fp-1',
        companyId: 'company-1',
      });
      mockPrisma.fuelPriceHistory.delete.mockResolvedValueOnce({ id: 'fp-1' });

      await expect(service.deleteFuelPrice('company-1', 'fp-1')).resolves.toEqual({
        message: 'Fuel price deleted',
      });
      expect(mockPrisma.fuelPriceHistory.delete).toHaveBeenCalledWith({ where: { id: 'fp-1' } });
    });
  });
});
