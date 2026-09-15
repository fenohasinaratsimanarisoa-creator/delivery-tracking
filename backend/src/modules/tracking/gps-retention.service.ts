import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { acquireCronLock } from '../../common/scheduling/cron-lock';
import { AlertService } from '../../common/alerting/alert.service';

const RETENTION_DAYS = 90;
// Suppression par lots plutôt qu'un DELETE unique : la table `gps_positions`
// grandit en continu (un point toutes les quelques secondes par véhicule actif)
// et peut accumuler un gros retard (première exécution après un long
// historique, cron en panne plusieurs semaines...). Un DELETE massif dans une
// seule transaction retiendrait des verrous et gonflerait le WAL pendant
// longtemps ; par lots, chaque itération reste courte.
const BATCH_SIZE = 5000;

@Injectable()
export class GpsRetentionService {
  private readonly logger = new Logger(GpsRetentionService.name);

  constructor(
    private prisma: PrismaService,
    private alertService: AlertService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  /**
   * Purge des positions GPS brutes de plus de 90 jours — décision produit
   * 2026-09-16 (voir conversation) : seule la trace GPS brute, la plus
   * volumineuse sur disque, est purgée. Les livraisons, preuves de livraison,
   * rapports carburant et anomalies déjà détectées (location_mismatch sur
   * Delivery, DailyFuelReport, etc.) restent conservés indéfiniment — ce sont
   * eux la preuve exploitable en cas de litige, pas les pings GPS bruts.
   * Hebdomadaire (comme la purge des notifications, même heure creuse) ;
   * verrou distribué (plusieurs instances backend/worker, voir cron-lock.ts).
   */
  @Cron('0 3 * * 0')
  async purgeOldPositions() {
    if (!(await acquireCronLock(this.redis, 'gps.purgeOldPositions', 3600))) return;

    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    try {
      for (;;) {
        const batch = await this.prisma.gpsPosition.findMany({
          where: { timestamp: { lt: cutoff } },
          select: { id: true },
          take: BATCH_SIZE,
        });
        if (batch.length === 0) break;
        await this.prisma.gpsPosition.deleteMany({
          where: { id: { in: batch.map((row) => row.id) } },
        });
        totalDeleted += batch.length;
        if (batch.length < BATCH_SIZE) break;
      }
      if (totalDeleted > 0) {
        this.logger.log(`Purged ${totalDeleted} GPS position(s) older than ${RETENTION_DAYS} days`);
      }
    } catch (err) {
      this.logger.error(`GPS position purge failed: ${(err as Error).message}`);
      await this.alertService.sendCriticalError(err as Error, { job: 'gps.purgeOldPositions' });
    }
  }
}
