import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { Public } from '../common/decorators/public.decorator';

// Consulté sans authentification par le load balancer / le monitoring
// (probe de disponibilité) : ne doit jamais exiger de JWT.
@Public()
@Controller('health')
export class HealthController {
  private redis: Redis | null = null;
  private fuelQueue: Queue | null = null;

  constructor(private prisma: PrismaService) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        enableOfflineQueue: false,
      });
    }
    if (this.redis) {
      this.fuelQueue = new Queue('fuel-analysis', { connection: this.redis });
    }
  }

  @Get()
  async check() {
    const checks: Record<string, { status: string; error?: string }> = {};

    checks.database = await this.checkDatabase();
    checks.redis = await this.checkRedis();
    checks.queue = await this.checkQueue();

    // SEULE la base de données est un critère de vie/mort pour le load balancer.
    // AVANT : `allOk = every(status === 'ok')` renvoyait 503 dès que :
    //   - Redis n'était pas configuré (status 'skipped') → /health en 503 permanent
    //     sur tout déploiement sans Redis ;
    //   - la file fuel-analysis accumulait failed>=10 ou active>=5 (status
    //     'degraded') → un simple retard de tâche de fond faisait retirer /
    //     redémarrer en boucle un backend qui servait parfaitement les requêtes.
    // Redis et les files sont donc rapportés (observabilité) mais NON fatals ici.
    const databaseDown = checks.database.status === 'error';

    if (databaseDown) {
      throw new HttpException(
        { status: 'unavailable', timestamp: new Date().toISOString(), checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const degraded = Object.values(checks).some(
      (c) => c.status === 'error' || c.status === 'degraded',
    );

    return {
      status: degraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  }

  private async checkRedis() {
    if (!this.redis) {
      return { status: 'skipped', error: 'REDIS_URL not configured' };
    }
    try {
      await this.redis.ping();
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  }

  private async checkQueue() {
    if (!this.fuelQueue) {
      return { status: 'skipped', error: 'BullMQ not configured (no Redis)' };
    }
    try {
      const [waiting, active, delayed, failed] = await Promise.all([
        this.fuelQueue.getWaitingCount(),
        this.fuelQueue.getActiveCount(),
        this.fuelQueue.getDelayedCount(),
        this.fuelQueue.getFailedCount(),
      ]);
      const ok = failed < 10 && active < 5;
      return {
        status: ok ? 'ok' : 'degraded',
        counts: { waiting, active, delayed, failed },
      };
    } catch (err) {
      return { status: 'error', error: (err as Error).message };
    }
  }
}
