import { Module, Global, Logger, OnModuleInit, Inject } from '@nestjs/common';
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
        return new Redis(process.env.REDIS_URL, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          lazyConnect: true,
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
          lazyConnect: true,
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
          lazyConnect: true,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_PUB_CLIENT, REDIS_SUB_CLIENT],
})
export class RedisModule implements OnModuleInit {
  private readonly logger = new Logger(RedisModule.name);

  constructor(
    @Inject(REDIS_CLIENT) private redis: Redis | null,
    @Inject(REDIS_PUB_CLIENT) private pub: Redis | null,
    @Inject(REDIS_SUB_CLIENT) private sub: Redis | null,
  ) {}

  onModuleInit() {
    // lazyConnect + enableOfflineQueue:false makes the first command race the
    // connection, throwing "Stream isn't writeable". Warm connections at boot.
    for (const client of [this.redis, this.pub, this.sub]) {
      if (client) {
        client.connect().catch((err) => {
          this.logger.warn(`Redis connect deferred: ${err?.message || err}`);
        });
      }
    }
  }
}
