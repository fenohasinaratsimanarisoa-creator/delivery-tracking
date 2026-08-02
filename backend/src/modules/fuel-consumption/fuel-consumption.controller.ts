import { Controller, Get, Post, Put, Body, Param, Query, Patch, Delete, UseGuards } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { UpdateFuelLogDto } from './dto/update-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';
import { CreateFuelPriceDto } from './dto/create-fuel-price.dto';
import { UpdateFuelPriceDto } from './dto/update-fuel-price.dto';
import { UpdateDefaultFuelPricesDto } from './dto/update-default-fuel-prices.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('fuel-consumption')
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
export class FuelConsumptionController {
  constructor(private readonly fuelService: FuelConsumptionService) {}

  @Roles('admin', 'dispatcher')
  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateFuelLogDto) {
    return this.fuelService.create(companyId, dto);
  }

  @Roles('admin', 'dispatcher')
  @Get()
  findAll(@CurrentUser('companyId') companyId: string, @Query() filter: FuelFilterDto) {
    return this.fuelService.findAll(companyId, filter);
  }

  @Roles('admin', 'dispatcher')
  @Get('stats')
  getStats(@CurrentUser('companyId') companyId: string, @Query('vehicleId') vehicleId?: string) {
    return this.fuelService.getConsumptionStats(companyId, vehicleId);
  }

  @Roles('admin', 'dispatcher')
  @Get('daily-reports')
  getDailyReports(
    @CurrentUser('companyId') companyId: string,
    @Query('date') date?: string,
  ) {
    return this.fuelService.getDailyReports(companyId, date);
  }

  @Roles('admin', 'dispatcher')
  @Post('daily-reports/generate')
  async generateDailyReport(
    @CurrentUser('companyId') companyId: string,
    @Body('date') date?: string,
  ) {
    await this.fuelService.generateDailyReportForCompanyOnDemand(companyId, date);
    const reports = await this.fuelService.getDailyReports(companyId, date);
    return { generated: true, reports };
  }

  // --- Prix carburant (modifiables et persistés) ---

  @Roles('admin', 'dispatcher')
  @Get('prices')
  getFuelPrices(@CurrentUser('companyId') companyId: string) {
    return this.fuelService.getFuelPrices(companyId);
  }

  @Roles('admin', 'dispatcher')
  @Put('prices/defaults')
  updateDefaultFuelPrices(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateDefaultFuelPricesDto,
  ) {
    return this.fuelService.updateDefaultFuelPrices(companyId, dto);
  }

  @Roles('admin', 'dispatcher')
  @Post('prices')
  createFuelPrice(@CurrentUser('companyId') companyId: string, @Body() dto: CreateFuelPriceDto) {
    return this.fuelService.createFuelPrice(companyId, dto);
  }

  @Roles('admin', 'dispatcher')
  @Patch('prices/:id')
  updateFuelPrice(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFuelPriceDto,
  ) {
    return this.fuelService.updateFuelPrice(companyId, id, dto);
  }

  @Roles('admin', 'dispatcher')
  @Delete('prices/:id')
  deleteFuelPrice(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.fuelService.deleteFuelPrice(companyId, id);
  }

  @Roles('admin', 'dispatcher')
  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.fuelService.findOne(companyId, id);
  }

  @Roles('admin', 'dispatcher')
  @Patch(':id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFuelLogDto,
  ) {
    return this.fuelService.update(companyId, id, dto);
  }

  @Roles('admin', 'dispatcher')
  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.fuelService.remove(companyId, id);
  }
}
