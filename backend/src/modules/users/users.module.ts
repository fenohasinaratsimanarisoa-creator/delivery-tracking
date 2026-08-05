import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsageGuard } from '../../common/guards/usage.guard';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsageGuard, VehicleAssignmentHistoryService],
  exports: [UsersService],
})
export class UsersModule {}
