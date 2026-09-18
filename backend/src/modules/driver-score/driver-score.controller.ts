import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DriverScoreService } from './driver-score.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('driver-scores')
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('admin', 'dispatcher')
export class DriverScoreController {
  constructor(private readonly driverScoreService: DriverScoreService) {}

  @Get('summary')
  async summary(@CurrentUser('companyId') companyId: string, @Query('days') daysParam?: string) {
    const days = Number.isFinite(Number(daysParam)) && Number(daysParam) > 0 ? Number(daysParam) : 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const summary = await this.driverScoreService.getScoreSummary(companyId, from, to);
    return Array.from(summary.entries()).map(([driverId, s]) => ({ driverId, ...s }));
  }
}
