import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/invitation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('invitations')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(companyId, userId, dto);
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  findAll(@CurrentUser('companyId') companyId: string) {
    return this.invitationsService.findAll(companyId);
  }

  @Post(':id/resend')
  @UseGuards(RolesGuard)
  @Roles('admin')
  resend(@CurrentUser('companyId') companyId: string, @Param('id') invitationId: string) {
    return this.invitationsService.resend(companyId, invitationId);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  revoke(@CurrentUser('companyId') companyId: string, @Param('id') invitationId: string) {
    return this.invitationsService.revoke(companyId, invitationId);
  }
}

@Controller('invitations')
export class PublicInvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('token') token: string,
    @Body() body: { password: string; firstName: string; lastName: string; phone?: string },
  ) {
    const user = await this.invitationsService.accept(token, body);
    return { message: 'Invitation accepted successfully', user };
  }
}
