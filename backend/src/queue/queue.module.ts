import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { FuelConsumptionModule } from '../modules/fuel-consumption/fuel-consumption.module';
import { FuelAnalysisProcessor } from './fuel-analysis.processor';
import { CompanyPurgeProcessor } from './company-purge.processor';
import { WebhookRetryProcessor } from './webhook-retry.processor';

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
    BullModule.registerQueue(
      { name: 'fuel-analysis' },
      { name: 'company-purge' },
      { name: 'webhook-retry' },
    ),
    NotificationsModule,
    FuelConsumptionModule,
  ],
  providers: [FuelAnalysisProcessor, CompanyPurgeProcessor, WebhookRetryProcessor],
  exports: [BullModule],
})
export class QueueModule {}
