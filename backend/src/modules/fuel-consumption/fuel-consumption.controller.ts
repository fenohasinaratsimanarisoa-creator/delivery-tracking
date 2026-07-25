import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { FuelConsumptionService } from './fuel-consumption.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';
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

  @Roles('admin', 'dispatcher')
  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.fuelService.findOne(companyId, id);
  }
}
