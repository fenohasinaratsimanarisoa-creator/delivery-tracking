import { Module } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';

@Module({
  controllers: [DriversController],
  providers: [DriversService, VehicleAssignmentHistoryService],
  exports: [DriversService],
})
export class DriversModule {}
