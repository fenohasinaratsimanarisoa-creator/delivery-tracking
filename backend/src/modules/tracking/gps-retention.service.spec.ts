import { PrismaService } from '../../common/prisma/prisma.service';
import { AlertService } from '../../common/alerting/alert.service';
import { GpsRetentionService } from './gps-retention.service';

const mockPrisma = {
  gpsPosition: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
};

const mockAlertService = {
  sendCriticalError: jest.fn(),
};

describe('GpsRetentionService', () => {
  let service: GpsRetentionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    service = new GpsRetentionService(
      mockPrisma as unknown as PrismaService,
      mockAlertService as unknown as AlertService,
      mockRedis as never,
    );
  });

  describe('purgeOldPositions', () => {
    it('supprime les positions dont timestamp dépasse 90 jours', async () => {
      // Un seul appel findMany attendu : le lot (2 lignes) est plus petit que
      // BATCH_SIZE, la boucle s'arrête donc sans refaire un appel de contrôle.
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
      mockPrisma.gpsPosition.deleteMany.mockResolvedValueOnce({ count: 2 });

      await service.purgeOldPositions();

      expect(mockPrisma.gpsPosition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { timestamp: { lt: expect.any(Date) } },
          select: { id: true },
          take: 5000,
        }),
      );
      expect(mockPrisma.gpsPosition.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['p1', 'p2'] } },
      });
    });

    it("ne supprime rien s'il n'y a aucune position à purger", async () => {
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]);
      await service.purgeOldPositions();
      expect(mockPrisma.gpsPosition.deleteMany).not.toHaveBeenCalled();
    });

    it("continue par lots tant que le lot est plein (BATCH_SIZE atteint), puis s'arrête sur un lot incomplet", async () => {
      const fullBatch = Array.from({ length: 5000 }, (_, i) => ({ id: `p${i}` }));
      mockPrisma.gpsPosition.findMany
        .mockResolvedValueOnce(fullBatch)
        .mockResolvedValueOnce([{ id: 'last' }]);
      mockPrisma.gpsPosition.deleteMany.mockResolvedValue({ count: 0 });

      await service.purgeOldPositions();

      // Le dernier lot fait moins de BATCH_SIZE : la boucle s'arrête sans
      // refaire un 3e appel findMany pour vérifier qu'il n'y a plus rien.
      expect(mockPrisma.gpsPosition.findMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.gpsPosition.deleteMany).toHaveBeenCalledTimes(2);
    });

    it('passe son tour si le verrou cron est tenu par une autre instance', async () => {
      mockRedis.set.mockResolvedValueOnce(null);
      await service.purgeOldPositions();
      expect(mockPrisma.gpsPosition.findMany).not.toHaveBeenCalled();
    });

    it("alerte via AlertService en cas d'échec, sans laisser planter le cron", async () => {
      mockPrisma.gpsPosition.findMany.mockRejectedValueOnce(new Error('DB down'));
      await expect(service.purgeOldPositions()).resolves.toBeUndefined();
      expect(mockAlertService.sendCriticalError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ job: 'gps.purgeOldPositions' }),
      );
    });
  });
});
