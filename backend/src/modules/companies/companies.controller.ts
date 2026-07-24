import { Controller, Get, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateCompanySettingsDto, UpdateCompanyFuelSettingsDto } from './dto/company-settings.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get(':id/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  getSettings(@CurrentUser('companyId') companyId: string) {
    return this.companiesService.getSettings(companyId);
  }

  @Patch(':id/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  updateSettings(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateCompanySettingsDto,
  ) {
    return this.companiesService.updateSettings(companyId, dto);
  }

  @Patch(':id/fuel-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  updateFuelSettings(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: UpdateCompanyFuelSettingsDto,
  ) {
    return this.companiesService.updateFuelSettings(companyId, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  deleteCompany(
    @CurrentUser('companyId') companyId: string,
    @Body('confirmationName') confirmationName: string,
  ) {
    return this.companiesService.deleteCompany(companyId, confirmationName);
  }
}
