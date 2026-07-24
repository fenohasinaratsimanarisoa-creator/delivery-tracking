import { Controller, Get, Delete, Param, UseGuards, Req } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser as CurrentUserDecorator } from '../../common/decorators/current-user.decorator';

@Controller('sessions')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  getSessions(@CurrentUserDecorator('id') userId: string) {
    return this.sessionsService.findAll(userId);
  }

  @Delete(':id')
  revokeSession(
    @CurrentUserDecorator('id') userId: string,
    @CurrentUserDecorator('companyId') companyId: string,
    @Param('id') sessionId: string,
    @Req() req: any,
  ) {
    return this.sessionsService.revokeSession(
      userId,
      sessionId,
      companyId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Delete()
  revokeAllSessions(
    @CurrentUserDecorator('id') userId: string,
    @CurrentUserDecorator('companyId') companyId: string,
    @CurrentUserDecorator('sessionId') exceptSessionId: string | undefined,
    @Req() req: any,
  ) {
    return this.sessionsService.revokeAllSessions(
      userId,
      companyId,
      exceptSessionId,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Get('history')
  getLoginHistory(@CurrentUserDecorator('id') userId: string) {
    return this.sessionsService.getLoginHistory(userId);
  }
}
