import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FuelConsumptionService } from './fuel-consumption.service';
import { FuelConsumptionController } from './fuel-consumption.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule, ScheduleModule],
  controllers: [FuelConsumptionController],
  providers: [FuelConsumptionService],
  exports: [FuelConsumptionService],
})
export class FuelConsumptionModule {}
