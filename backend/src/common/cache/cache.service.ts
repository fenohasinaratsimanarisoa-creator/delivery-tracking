import { Inject, Injectable, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

@Injectable()
export class CacheService {
  private readonly fallback = new Map<string, { value: unknown; expiry: number }>();

  constructor(@Optional() @Inject(REDIS_CLIENT) private redis: Redis | null) {}

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      const raw = await this.redis.get(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
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
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      return;
    }
    this.fallback.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  async invalidate(pattern: string): Promise<void> {
    if (this.redis) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return;
    }
    for (const key of this.fallback.keys()) {
      if (key.startsWith(pattern.replace('*', ''))) {
        this.fallback.delete(key);
      }
    }
  }
}
