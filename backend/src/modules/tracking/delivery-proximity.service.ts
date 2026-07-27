import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { haversineDistance } from '../../common/geo/geo.utils';

const PROXIMITY_THRESHOLD_M = 300;
const ESCALATION_AFTER_MS = 15 * 60 * 1000;
const SNOOZE_MS = 5 * 60 * 1000;
const ESCALATION_SNOOZE_MS = 2 * 60 * 1000;

@Injectable()
export class DeliveryProximityService {
  private readonly logger = new Logger(DeliveryProximityService.name);
  private lastDeliveryId: string | null = null;

  constructor(
    private prisma: PrismaService,
    private dataUpdateBus: DataUpdateBus,
    private cacheService: CacheService,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  private async getProximityKey(deliveryId: string, vehicleId: string): Promise<string> {
    return `proximity:entered:${deliveryId}:${vehicleId}`;
  }

  private async getSnoozeKey(deliveryId: string, vehicleId: string): Promise<string> {
    return `proximity:snoozed:${deliveryId}:${vehicleId}`;
  }

  private async setEnteredTime(deliveryId: string, vehicleId: string, timestamp: number): Promise<void> {
    const key = await this.getProximityKey(deliveryId, vehicleId);
    if (this.redis) {
      await this.redis.set(key, timestamp, 'EX', 86400);
    } else {
      await this.cacheService.set(key, timestamp, 86400);
    }
  }

  private async getEnteredTime(deliveryId: string, vehicleId: string): Promise<number | null> {
    const key = await this.getProximityKey(deliveryId, vehicleId);
    if (this.redis) {
      const val = await this.redis.get(key);
      return val ? parseInt(val, 10) : null;
    }
    const cached = await this.cacheService.get<number>(key);
    return cached ?? null;
  }

  private async removeEnteredTime(deliveryId: string, vehicleId: string): Promise<void> {
    const key = await this.getProximityKey(deliveryId, vehicleId);
    if (this.redis) {
      await this.redis.del(key);
    } else {
      await this.cacheService.invalidate(key);
    }
  }

  private async isSnoozed(deliveryId: string, vehicleId: string): Promise<boolean> {
    const key = await this.getSnoozeKey(deliveryId, vehicleId);
    if (this.redis) {
      const val = await this.redis.get(key);
      return val !== null && parseInt(val, 10) > Date.now();
    }
    const cached = await this.cacheService.get<number>(key);
    return cached !== null && cached > Date.now();
  }

  async checkProximity(
    driverId: string,
    vehicleId: string,
    companyId: string,
    latitude: number,
    longitude: number,
    timestamp: Date,
  ): Promise<void> {
    try {
      const driver = await this.prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, userId: true },
      });
      if (!driver?.userId) return;

      const inProgressDelivery = await this.prisma.delivery.findFirst({
        where: {
          driverId,
          status: 'in_progress',
          deletedAt: null,
          deliveryLat: { not: null },
          deliveryLng: { not: null },
        },
        select: { id: true, title: true, deliveryLat: true, deliveryLng: true },
      });

      if (!inProgressDelivery) {
        if (this.lastDeliveryId) {
          await this.removeEnteredTime(this.lastDeliveryId, vehicleId);
          this.lastDeliveryId = null;
        }
        return;
      }
      this.lastDeliveryId = inProgressDelivery.id;

      const dist = haversineDistance(
        latitude,
        longitude,
        inProgressDelivery.deliveryLat!,
        inProgressDelivery.deliveryLng!,
      );

      const now = Date.now();

      if (dist <= PROXIMITY_THRESHOLD_M) {
        const enteredAt = await this.getEnteredTime(inProgressDelivery.id, vehicleId);
        if (enteredAt === null) {
          await this.setEnteredTime(inProgressDelivery.id, vehicleId, now);
        }

        const timeInZone = now - (enteredAt ?? now);
        const escalationLevel = timeInZone > ESCALATION_AFTER_MS ? 2 : timeInZone > ESCALATION_AFTER_MS / 2 ? 1 : 0;

        if (await this.isSnoozed(inProgressDelivery.id, vehicleId)) return;

        const title = inProgressDelivery.title || 'Livraison';
        const message = escalationLevel >= 2
          ? `⚠️ Vous êtes sur place depuis plus de ${Math.round(timeInZone / 60000)} min. Veuillez valider la livraison.`
          : 'Vous êtes à proximité du point de livraison. N\'oubliez pas de valider.';
        const urgency = escalationLevel >= 2 ? 'critical' : escalationLevel >= 1 ? 'high' : 'normal';

        this.dataUpdateBus.emitUpdate({
          companyId,
          entity: 'proximityAlert',
          action: 'send',
          targetUserId: driver.userId,
          payload: {
            type: 'proximity',
            title,
            message,
            deliveryId: inProgressDelivery.id,
            urgency,
            snoozable: true,
            escalationLevel,
            timestamp: timestamp.toISOString(),
          },
        });

        this.logger.log(
          `[PROXIMITY] driver=${driverId} delivery=${inProgressDelivery.id} dist=${Math.round(dist)}m escalation=${escalationLevel} urgency=${urgency}`,
        );
      } else {
        await this.removeEnteredTime(inProgressDelivery.id, vehicleId);
      }
    } catch (err: any) {
      this.logger.error(`Proximity check error: ${err.message}`);
    }
  }
}
