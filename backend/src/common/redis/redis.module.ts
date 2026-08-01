import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_PUB_CLIENT = 'REDIS_PUB_CLIENT';
export const REDIS_SUB_CLIENT = 'REDIS_SUB_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        if (!process.env.REDIS_URL) return null;
        // Connects eagerly on boot: with lazyConnect the first command issued
        // before the connection is ready throws instead of being retried
        // (enableOfflineQueue is false), causing a 500 on first use.
        return new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        });
      },
    },
    {
      provide: REDIS_PUB_CLIENT,
      useFactory: () => {
        if (!process.env.REDIS_URL) return null;
        return new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        });
      },
    },
    {
      provide: REDIS_SUB_CLIENT,
      useFactory: () => {
        if (!process.env.REDIS_URL) return null;
        return new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_PUB_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule {}
