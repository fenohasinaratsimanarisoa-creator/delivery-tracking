import { Module } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';
import { FuelConsumptionController } from './fuel-consumption.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [FuelConsumptionController],
  providers: [FuelConsumptionService],
  exports: [FuelConsumptionService],
})
export class FuelConsumptionModule {}
