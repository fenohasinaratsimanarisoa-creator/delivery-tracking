import { Module } from '@nestjs/common';
import { DeliveriesService } from './deliveries.service';
import { DeliveriesController } from './deliveries.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { UsageGuard } from '../../common/guards/usage.guard';

@Module({
  imports: [NotificationsModule, WebhooksModule, GeocodingModule],
  controllers: [DeliveriesController],
  providers: [DeliveriesService, UsageGuard],
  exports: [DeliveriesService],
})
export class DeliveriesModule {}
