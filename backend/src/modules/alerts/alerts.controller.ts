import { Controller, Get, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('alerts')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher', 'driver')
  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('types') typesStr?: string,
    @Query('priorities') prioritiesStr?: string,
    @Query('resolved') resolved?: string,
    @Query('deliveryId') deliveryId?: string,
    @Query('period') period?: string,
  ) {
    return this.alertsService.findAll(companyId, {
      page: page ? +page : 1,
      limit: limit ? +limit : 20,
      types: typesStr ? (typesStr.split(',') as NotificationType[]) : undefined,
      priorities: prioritiesStr ? (prioritiesStr.split(',') as NotificationPriority[]) : undefined,
      resolved: resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      deliveryId,
      period: period as any,
    },
    // Un driver ne voit QUE ses propres alertes — scope strict côté backend.
    role === 'driver' ? userId : undefined);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get('stats')
  stats(@CurrentUser('companyId') companyId: string, @Query('period') period?: string) {
    return this.alertsService.stats(companyId, period);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Patch(':id/resolve')
  resolve(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return this.alertsService.resolve(companyId, id, userId, body.comment);
  }
}
