import { Module } from '@nestjs/common';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { VehicleMaintenanceController } from './vehicle-maintenance.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [VehicleMaintenanceController],
  providers: [VehicleMaintenanceService],
  exports: [VehicleMaintenanceService],
})
export class VehicleMaintenanceModule {}
