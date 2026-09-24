import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LOG_REDACT } from '../common/logging/redact-paths';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from '../common/prisma/prisma.module';
import { RedisModule } from '../common/redis/redis.module';
import { CacheModule } from '../common/cache/cache.module';
import { DataUpdateModule } from '../common/events/data-update.module';
import { AlertModule } from '../common/alerting/alert.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { TenantModule } from '../common/tenant/tenant.module';
import { QueueModule } from './queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        redact: LOG_REDACT,
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      },
    }),
    PrismaModule,
    RedisModule,
    CacheModule,
    DataUpdateModule,
    AlertModule,
    EncryptionModule,
    TenantModule,
    QueueModule,
  ],
})
export class QueueWorkerModule {}
