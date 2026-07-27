import { Inject, Injectable, Optional, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly fallback = new Map<string, { value: unknown; expiry: number }>();

  constructor(@Optional() @Inject(REDIS_CLIENT) private redis: Redis | null) {}

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw === null) return null;
        return JSON.parse(raw) as T;
      } catch (err) {
        this.logger.warn(`Redis get failed for key "${key}", using in-memory fallback: ${(err as Error).message}`);
      }
    }
    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (entry.expiry && Date.now() > entry.expiry) {
      this.fallback.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    if (this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
        return;
      } catch (err) {
        this.logger.warn(`Redis set failed for key "${key}", using in-memory fallback: ${(err as Error).message}`);
      }
    }
    this.fallback.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  async invalidate(pattern: string): Promise<void> {
    if (this.redis) {
      try {
        let cursor = '0';
        const keysToDelete: string[] = [];
        do {
          const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', '200');
          cursor = result[0];
          keysToDelete.push(...result[1]);
        } while (cursor !== '0');
        if (keysToDelete.length > 0) {
          await this.redis.del(...keysToDelete);
        }
        return;
      } catch (err) {
        this.logger.warn(`Redis invalidate failed for pattern "${pattern}", falling back to in-memory: ${(err as Error).message}`);
      }
    }
    for (const key of this.fallback.keys()) {
      if (key.startsWith(pattern.replace('*', ''))) {
        this.fallback.delete(key);
      }
    }
  }
}
