import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';

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

    const allOk = Object.values(checks).every((c) => c.status === 'ok');

    if (!allOk) {
      throw new HttpException(
        { status: 'degraded', timestamp: new Date().toISOString(), checks },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', timestamp: new Date().toISOString(), checks };
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
