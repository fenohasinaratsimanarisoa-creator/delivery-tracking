import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminService } from './platform-admin.service';
import { TrackingService } from '../tracking/tracking.service';
import { TraccarBridgeService } from '../tracking/traccar-bridge.service';
import { PlatformAdminLoginDto } from './dto/login.dto';
import { PlatformAdminVerify2faDto } from './dto/verify-2fa.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { PlatformAdminChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';

@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly service: PlatformAdminService,
    private readonly trackingService: TrackingService,
    private readonly traccarBridgeService: TraccarBridgeService,
  ) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: PlatformAdminLoginDto, @Req() req: any) {
    const result = await this.service.login(dto, req.ip, req.headers?.['user-agent']);
    return result;
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('auth/verify-2fa')
  @HttpCode(HttpStatus.OK)
  async verify2fa(@Body() dto: PlatformAdminVerify2faDto, @Req() req: any) {
    return this.service.verify2fa(dto, req.ip, req.headers?.['user-agent']);
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('auth/setup-2fa')
  @HttpCode(HttpStatus.OK)
  async setup2fa(@Body() dto: PlatformAdminVerify2faDto, @Req() req: any) {
    return this.service.verify2faSetupAndLogin(
      dto.tempToken,
      dto.token,
      req.ip,
      req.headers?.['user-agent'],
    );
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('profile')
  async getProfile(@CurrentUser('id') adminId: string) {
    return this.service.getProfile(adminId);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('tenants')
  async getTenants() {
    return this.service.getTenants();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Patch('tenants/:id/toggle')
  @HttpCode(HttpStatus.OK)
  async toggleTenant(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
    @Req() req: any,
  ) {
    return this.service.toggleTenantStatus(companyId, adminId, req.ip);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('tenants/:id/impersonate')
  @HttpCode(HttpStatus.OK)
  async impersonate(
    @Param('id') companyId: string,
    @CurrentUser('id') adminId: string,
    @CurrentUser('email') adminEmail: string,
    @Req() req: any,
  ) {
    return this.service.impersonate(companyId, adminId, adminEmail, req.ip);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('metrics')
  async getMetrics() {
    return this.service.getMetrics();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('audit-logs')
  async getAuditLogs(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.service.getAuditLogs(page || 1, Math.min(limit || 20, 100));
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('admins')
  async getAdmins() {
    return this.service.getAdmins();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(@Body() dto: CreateAdminDto) {
    return this.service.setupAdmin(dto.email, dto.password, dto.firstName, dto.lastName);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('2fa/generate')
  async generate2fa(@CurrentUser('id') adminId: string) {
    return this.service.generate2fa(adminId);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2faSetup(@CurrentUser('id') adminId: string, @Body('token') token: string) {
    return this.service.verify2faSetup(adminId, token);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  async disable2fa(@CurrentUser('id') adminId: string, @Body('token') token: string) {
    return this.service.disable2fa(adminId, token);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser('id') adminId: string,
    @Body() dto: PlatformAdminChangePasswordDto,
  ) {
    await this.service.changePassword(adminId, dto.currentPassword, dto.newPassword);
    return { message: 'Mot de passe modifié avec succès' };
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('traccar/status')
  async getTraccarStatus() {
    return this.traccarBridgeService.getStatus();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('traccar/diagnose')
  async diagnoseTraccar() {
    return this.traccarBridgeService.diagnosePlatformConfig();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('tracking/archive')
  @HttpCode(HttpStatus.OK)
  async archiveAllPositions(@Body('before') before: string) {
    // Même garde que POST /tracking/archive : date invalide -> 400 explicite
    // au lieu d'un Invalid Date avalé par le garde "48h minimum".
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('`before` must be a valid ISO-8601 date');
    }
    const count = await this.trackingService.archiveAllCompaniesPositionsBefore(beforeDate);
    return { archived: count };
  }
}
