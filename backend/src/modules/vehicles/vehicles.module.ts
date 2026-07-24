import { Module } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { UsageGuard } from '../../common/guards/usage.guard';

@Module({
  controllers: [VehiclesController],
  providers: [VehiclesService, UsageGuard],
  exports: [VehiclesService],
})
export class VehiclesModule {}
