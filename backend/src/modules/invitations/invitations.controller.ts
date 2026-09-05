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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';

@Controller('invitations')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @UseGuards(RolesGuard, BlockImpersonationGuard)
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
  @UseGuards(RolesGuard, BlockImpersonationGuard)
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

  // Consulté par la page publique d'acceptation (avant que l'invité ne saisisse
  // quoi que ce soit) : uniquement les champs nécessaires à l'affichage, jamais
  // l'objet Company complet (adresse/téléphone) ni l'id de l'invitation.
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Get(':token')
  async getInvitation(@Param('token') token: string) {
    const invitation = await this.invitationsService.findByToken(token);
    return {
      email: invitation.email,
      role: invitation.role,
      companyName: invitation.company.name,
      expiresAt: invitation.expiresAt,
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  async accept(@Param('token') token: string, @Body() body: AcceptInvitationDto) {
    const user = await this.invitationsService.accept(token, body);
    return { message: 'Invitation accepted successfully', user };
  }
}
