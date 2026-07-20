import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('fuel-consumption')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class FuelConsumptionController {
  constructor(private readonly fuelService: FuelConsumptionService) {}

  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateFuelLogDto) {
    return this.fuelService.create(companyId, dto);
  }

  @Get()
  findAll(@CurrentUser('companyId') companyId: string, @Query() filter: FuelFilterDto) {
    return this.fuelService.findAll(companyId, filter);
  }

  @Get('stats')
  getStats(
    @CurrentUser('companyId') companyId: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    return this.fuelService.getConsumptionStats(companyId, vehicleId);
  }

  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.fuelService.findOne(companyId, id);
  }
}
