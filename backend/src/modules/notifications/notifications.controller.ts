import { Controller, Get, Patch, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationsService.findAll(companyId, userId, Number(limit) || 50);
  }

  @Get('unread-count')
  countUnread(@CurrentUser('companyId') companyId: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.countUnread(companyId, userId);
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.notificationsService.markRead(id, companyId, userId);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser('companyId') companyId: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markAllRead(companyId, userId);
  }

  @Delete(':id')
  remove(
    @Param('id') id: string,
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.notificationsService.remove(id, companyId, userId);
  }

  @Delete()
  removeAll(@CurrentUser('companyId') companyId: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.removeAll(companyId, userId);
  }
}
