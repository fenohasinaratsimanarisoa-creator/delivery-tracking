import { Controller } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';

@Controller('fuel-consumption')
export class FuelConsumptionController {
  constructor(private readonly fuelConsumptionService: FuelConsumptionService) {}
}
