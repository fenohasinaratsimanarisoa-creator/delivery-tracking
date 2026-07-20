import { Module } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';
import { FuelConsumptionController } from './fuel-consumption.controller';

@Module({
  controllers: [FuelConsumptionController],
  providers: [FuelConsumptionService],
  exports: [FuelConsumptionService],
})
export class FuelConsumptionModule {}
