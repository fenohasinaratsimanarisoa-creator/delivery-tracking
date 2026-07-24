import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { FuelAnalysisProcessor } from './fuel-analysis.processor';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        return {
          connection: redisUrl
            ? { url: redisUrl, maxRetriesPerRequest: null }
            : { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null, lazyConnect: true },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600 * 24 * 3 },
            removeOnFail: { age: 3600 * 24 * 7 },
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'fuel-analysis',
    }),
    NotificationsModule,
  ],
  providers: [FuelAnalysisProcessor],
  exports: [BullModule],
})
export class QueueModule {}
