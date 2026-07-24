import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get('my-activity')
  getMyActivity(@CurrentUser('id') userId: string, @Query('limit') limit = 50) {
    return this.auditLogService.findByUser(userId, +limit);
  }

  @Get('company-activity')
  @UseGuards(RolesGuard)
  @Roles('admin')
  getCompanyActivity(@CurrentUser('companyId') companyId: string, @Query('limit') limit = 100) {
    return this.auditLogService.findByCompany(companyId, +limit);
  }
}
