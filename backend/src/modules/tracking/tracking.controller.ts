import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiKeyOrJwtGuard } from '../api-keys/guards/api-key-or-jwt.guard';
import { ApiKeyScope } from '../api-keys/decorators/api-key-scope.decorator';

@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(ApiKeyOrJwtGuard)
  @ApiKeyScope('tracking:read')
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-API-Key',
    required: false,
    description: 'Alternative to Bearer token for read-only access',
  })
  @ApiOperation({
    summary: 'Get GPS positions for a delivery',
    description: 'Requires JWT or API key with tracking:read scope',
  })
  @Get('positions/:deliveryId')
  getPositions(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 200,
  ) {
    return this.trackingService.getPositionsByDelivery(deliveryId, companyId, +page, +limit);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @ApiKeyScope('tracking:read')
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-API-Key',
    required: false,
    description: 'Alternative to Bearer token for read-only access',
  })
  @ApiOperation({ summary: 'Calculate total distance for a delivery' })
  @Get('distance/:deliveryId')
  getDistance(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.calculateDistance(deliveryId, companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a public tracking token (24h expiry)' })
  @Post('public-token')
  async generatePublicToken(
    @CurrentUser('companyId') companyId: string,
    @Body('deliveryId') deliveryId: string,
  ) {
    await this.trackingService.getDeliveryInfo(deliveryId, companyId);

    const token = this.jwtService.sign(
      { deliveryId, companyId, scope: 'public-tracking' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        expiresIn: '24h',
      },
    );
    return {
      trackingUrl: `/tracking/${token}`,
      token,
      expiresIn: '24h',
    };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed trip report for a delivery' })
  @Get('report/:deliveryId')
  getTripReport(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.getTripReport(deliveryId, companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export trip report as PDF' })
  @Header('Content-Type', 'application/pdf')
  @Get('report/:deliveryId/export')
  async exportTripReport(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.trackingService.generateTripReportPdf(deliveryId, companyId);
    res.setHeader('Content-Disposition', `attachment; filename="trip-report-${deliveryId}.pdf"`);
    res.end(pdf);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Find nearest vehicle to a point' })
  @Get('nearest-vehicle')
  findNearestVehicle(
    @CurrentUser('companyId') companyId: string,
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.trackingService.findNearestVehicle(parseFloat(lat), parseFloat(lng), companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get live positions of all active vehicles in company' })
  @Get('live')
  getLivePositions(@CurrentUser('companyId') companyId: string) {
    return this.trackingService.getLivePositions(companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archiver les positions GPS avant une date' })
  @Post('archive')
  async archivePositions(@Body('before') before: string, @CurrentUser('companyId') companyId: string) {
    const count = await this.trackingService.archivePositionsBefore(new Date(before), companyId);
    return { archived: count };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke a public tracking link immediately' })
  @Post('revoke-token')
  async revokePublicToken(
    @CurrentUser('companyId') companyId: string,
    @Body('deliveryId') deliveryId: string,
  ) {
    await this.trackingService.revokePublicToken(deliveryId, companyId);
    return { message: 'Public tracking link revoked' };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tracking reliability metrics (received/saved/deduped/teleported)' })
  @Get('metrics')
  getMetrics() {
    return this.trackingService.getMetrics();
  }

  @ApiOperation({ summary: 'Get tracking info via public token (no auth required)' })
  @Get('public/:token')
  async getPublicTrackingInfo(@Param('token') token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });

      if (payload.scope !== 'public-tracking') {
        throw new UnauthorizedException('Invalid token scope');
      }

      const delivery = await this.trackingService.getDeliveryInfo(
        payload.deliveryId,
        payload.companyId,
      );

      if (delivery.publicTrackingRevokedAt) {
        throw new UnauthorizedException('This tracking link has been revoked');
      }

      const positions = await this.trackingService.getAllPositionsByDelivery(
        payload.deliveryId,
        payload.companyId,
      );

      return { delivery, positions };
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Invalid or expired tracking link');
    }
  }
}
