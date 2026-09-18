import { DriverScoreService } from './driver-score.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  company: {
    findMany: jest.fn(),
  },
  dailyFuelReport: {
    findMany: jest.fn(),
  },
  companySettings: {
    findUnique: jest.fn(),
  },
  gpsPosition: {
    findMany: jest.fn(),
  },
  driverScore: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('DriverScoreService', () => {
  let service: DriverScoreService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DriverScoreService(mockPrisma as unknown as PrismaService, null);
  });

  describe('computeScore', () => {
    it('retourne 100 sans aucun évènement', () => {
      expect(service.computeScore(0, 0, 200)).toBe(100);
    });

    it('pénalise la survitesse, normalisée par 100km au-dessus du seuil minimal', () => {
      // 5 évènements sur 200km → 2.5 évènements/100km × -2 = -5
      expect(service.computeScore(5, 0, 200)).toBe(95);
    });

    it('pénalise le freinage/accélération brusque, normalisée par 100km', () => {
      // 10 évènements sur 200km → 5/100km × -1 = -5
      expect(service.computeScore(0, 10, 200)).toBe(95);
    });

    it('plafonne la pénalité de survitesse à -30 même avec beaucoup d’évènements', () => {
      expect(service.computeScore(1000, 0, 100)).toBe(70);
    });

    it('plafonne la pénalité de freinage brusque à -30', () => {
      expect(service.computeScore(0, 1000, 100)).toBe(70);
    });

    it('ne descend jamais sous 0 même si les deux pénalités sont au plafond', () => {
      expect(service.computeScore(1000, 1000, 100)).toBe(40);
    });

    it("garde le compte BRUT (sans extrapolation) sous le seuil minimal de distance (20km)", () => {
      // 2 évènements sur 5km : si on normalisait à 100km, on obtiendrait
      // 2/(5/100)=40 évènements → pénalité écrasante pour un trajet minuscule.
      // Sous MIN_DISTANCE_FOR_NORMALIZATION_KM, on pénalise le compte brut.
      expect(service.computeScore(2, 0, 5)).toBe(96);
    });
  });

  describe('generateDailyScores', () => {
    it('calcule et upsert un score par (driver, vehicle) du jour, en réutilisant les DailyFuelReport', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.dailyFuelReport.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', vehicleId: 'veh-1', distanceKm: 150 },
      ]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: 80 });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        { speed: 20, timestamp: new Date('2026-09-18T08:00:00Z') },
        { speed: 25, timestamp: new Date('2026-09-18T08:00:01Z') },
      ]);

      await service.generateDailyScores();

      expect(mockPrisma.driverScore.upsert).toHaveBeenCalledTimes(1);
      const call = mockPrisma.driverScore.upsert.mock.calls[0][0];
      expect(call.where.driverId_vehicleId_scoreDate.driverId).toBe('drv-1');
      expect(call.create.companyId).toBe('comp-1');
      expect(call.create.distanceKm).toBe(150);
    });

    it('ignore les DailyFuelReport à distanceKm=0 (aucun déplacement réel ce jour)', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.dailyFuelReport.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', vehicleId: 'veh-1', distanceKm: 0 },
      ]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: 80 });

      await service.generateDailyScores();

      expect(mockPrisma.gpsPosition.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.driverScore.upsert).not.toHaveBeenCalled();
    });

    it("passe à l'entreprise suivante si une entreprise échoue (isolation par entreprise)", async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-fail' }, { id: 'comp-ok' }]);
      mockPrisma.dailyFuelReport.findMany
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([{ driverId: 'drv-2', vehicleId: 'veh-2', distanceKm: 80 }]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: 80 });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]);

      await expect(service.generateDailyScores()).resolves.not.toThrow();
      expect(mockPrisma.driverScore.upsert).toHaveBeenCalledTimes(1);
    });

    it('compte une survitesse pour chaque position au-dessus du seuil configuré', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.dailyFuelReport.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', vehicleId: 'veh-1', distanceKm: 150 },
      ]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: 80 });
      // 80 km/h = 22.22 m/s. Deux positions à 30 m/s (108 km/h) → survitesse.
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        { speed: 30, timestamp: new Date('2026-09-18T08:00:00Z') },
        { speed: 30, timestamp: new Date('2026-09-18T08:05:00Z') },
      ]);

      await service.generateDailyScores();

      const call = mockPrisma.driverScore.upsert.mock.calls[0][0];
      expect(call.create.speedingEvents).toBe(2);
    });

    it('détecte un freinage brusque entre deux positions rapprochées, pas un delta lent', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.dailyFuelReport.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', vehicleId: 'veh-1', distanceKm: 150 },
      ]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: null });
      // 20 m/s → 5 m/s en 1s : delta = 15 m/s = 54 km/h en 1s → très au-dessus du seuil (8 km/h/s).
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        { speed: 20, timestamp: new Date('2026-09-18T08:00:00Z') },
        { speed: 5, timestamp: new Date('2026-09-18T08:00:01Z') },
      ]);

      await service.generateDailyScores();

      const call = mockPrisma.driverScore.upsert.mock.calls[0][0];
      expect(call.create.harshEvents).toBe(1);
    });

    it('ignore un delta de vitesse séparé par un trou GPS de plus de 5s (faux positif évité)', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.dailyFuelReport.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', vehicleId: 'veh-1', distanceKm: 150 },
      ]);
      mockPrisma.companySettings.findUnique.mockResolvedValueOnce({ speedAlertThreshold: null });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([
        { speed: 20, timestamp: new Date('2026-09-18T08:00:00Z') },
        { speed: 5, timestamp: new Date('2026-09-18T08:00:10Z') },
      ]);

      await service.generateDailyScores();

      const call = mockPrisma.driverScore.upsert.mock.calls[0][0];
      expect(call.create.harshEvents).toBe(0);
    });
  });

  describe('getScoreSummary', () => {
    it('moyenne les scores quotidiens par chauffeur sur la période', async () => {
      mockPrisma.driverScore.findMany.mockResolvedValueOnce([
        { driverId: 'drv-1', score: 90, distanceKm: 100, speedingEvents: 1, harshEvents: 0 },
        { driverId: 'drv-1', score: 80, distanceKm: 120, speedingEvents: 0, harshEvents: 2 },
        { driverId: 'drv-2', score: 70, distanceKm: 50, speedingEvents: 3, harshEvents: 1 },
      ]);

      const result = await service.getScoreSummary('comp-1', new Date('2026-09-01'), new Date('2026-09-30'));

      expect(result.get('drv-1')).toEqual({
        avgScore: 85,
        daysScored: 2,
        distanceKm: 220,
        speedingEvents: 1,
        harshEvents: 2,
      });
      expect(result.get('drv-2')?.avgScore).toBe(70);
      expect(result.has('drv-3')).toBe(false);
    });

    it('retourne une map vide sans aucune donnée', async () => {
      mockPrisma.driverScore.findMany.mockResolvedValueOnce([]);

      const result = await service.getScoreSummary('comp-1', new Date(), new Date());

      expect(result.size).toBe(0);
    });
  });
});
