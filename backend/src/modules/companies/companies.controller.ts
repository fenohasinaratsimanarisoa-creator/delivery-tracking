import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateCompanySettingsDto, UpdateCompanyFuelSettingsDto } from './dto/company-settings.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  // L6 : avant, le paramètre :id était décoratif (le JWT companyId faisait foi, le
  // :id était ignoré). Un admin appelant /companies/<autre-id>/settings opérait en
  // silence sur SA propre company. Le :id doit désormais correspondre à la company
  // de l'utilisateur : sinon 404 (pas de fuite d'existence cross-tenant).
  private assertOwnCompany(companyId: string, paramId: string): void {
    if (paramId !== companyId) {
      throw new NotFoundException('Company not found');
    }
  }

  @Get(':id/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  getSettings(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    this.assertOwnCompany(companyId, id);
    return this.companiesService.getSettings(companyId);
  }

  @Patch(':id/settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  updateSettings(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanySettingsDto,
  ) {
    this.assertOwnCompany(companyId, id);
    return this.companiesService.updateSettings(companyId, dto);
  }

  @Patch(':id/fuel-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  updateFuelSettings(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyFuelSettingsDto,
  ) {
    this.assertOwnCompany(companyId, id);
    return this.companiesService.updateFuelSettings(companyId, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard, BlockImpersonationGuard)
  @Roles('admin')
  deleteCompany(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body('confirmationName') confirmationName: string,
  ) {
    this.assertOwnCompany(companyId, id);
    return this.companiesService.deleteCompany(companyId, confirmationName);
  }
}
