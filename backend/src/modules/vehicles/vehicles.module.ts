import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesService } from './vehicles.service';
import { VehiclesController } from './vehicles.controller';
import { UsageGuard } from '../../common/guards/usage.guard';

@Module({
  imports: [ConfigModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, UsageGuard],
  exports: [VehiclesService],
})
export class VehiclesModule {}
