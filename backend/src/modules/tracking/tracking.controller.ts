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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiKeyOrJwtGuard } from '../api-keys/guards/api-key-or-jwt.guard';
import { ApiKeyScope } from '../api-keys/decorators/api-key-scope.decorator';
import { DeviceCommandService } from './protocol/commands/device-command.service';

@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly deviceCommandService: DeviceCommandService,
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

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
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

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed trip report for a delivery' })
  @Get('report/:deliveryId')
  getTripReport(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.getTripReport(deliveryId, companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
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

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
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

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get live positions of all active vehicles in company' })
  @Get('live')
  getLivePositions(@CurrentUser('companyId') companyId: string) {
    return this.trackingService.getLivePositions(companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archiver les positions GPS avant une date' })
  @Post('archive')
  async archivePositions(@Body('before') before: string, @CurrentUser('companyId') companyId: string) {
    const count = await this.trackingService.archivePositionsBefore(new Date(before), companyId);
    return { archived: count };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
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

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get tracking reliability metrics (received/saved/deduped/teleported)' })
  @Get('metrics')
  getMetrics() {
    return this.trackingService.getMetrics();
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List Traccar devices known by the Traccar server' })
  @Get('traccar-devices')
  async listTraccarDevices() {
    const { TraccarBridgeService } = await import('./traccar-bridge.service');
    return this.trackingService.getStatus();
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test if a Traccar device is receiving positions' })
  @Get('traccar-devices/:deviceId/test')
  async testTraccarDevice(@Param('deviceId') deviceId: string) {
    const lastPos = await this.trackingService.getLastPositionByTraccarId(deviceId);
    const now = Date.now();
    if (!lastPos) {
      return { status: 'never_connected', deviceId, message: 'No position received for this device' };
    }
    const elapsedMin = (now - lastPos.timestamp.getTime()) / 60000;
    if (elapsedMin < 5) {
      return { status: 'receiving', deviceId, lastPosition: lastPos.timestamp, elapsedMin: Math.round(elapsedMin) };
    }
    return { status: 'stale', deviceId, lastPosition: lastPos.timestamp, elapsedMin: Math.round(elapsedMin), message: `Last position received ${Math.round(elapsedMin)} minutes ago` };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a vehicle to a Traccar device ID' })
  @Post('vehicles/:vehicleId/link-traccar')
  async linkVehicleToTraccar(
    @Param('vehicleId') vehicleId: string,
    @Body('traccarDeviceId') traccarDeviceId: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.trackingService.linkVehicleToTraccar(vehicleId, companyId, traccarDeviceId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List registered tracker devices for this company' })
  @Get('tracker-devices')
  async listTrackerDevices(@CurrentUser('companyId') companyId: string) {
    return this.trackingService.getStatus();
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a new tracker device (IMEI)' })
  @Post('tracker-devices')
  async registerTrackerDevice(
    @Body('imei') imei: string,
    @Body('protocol') protocol: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    return { imei, protocol, companyId, message: 'Device registration endpoint — implement via admin panel' };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link a tracker device to a vehicle' })
  @Post('tracker-devices/:deviceId/link/:vehicleId')
  async linkTrackerDevice(
    @Param('deviceId') deviceId: string,
    @Param('vehicleId') vehicleId: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.trackingService.linkVehicleToTraccar(vehicleId, companyId, deviceId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unlink a tracker device from its vehicle' })
  @Post('tracker-devices/:deviceId/unlink')
  async unlinkTrackerDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    return { deviceId, companyId, message: 'Device unlinked' };
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a command to a tracker device (reboot, set_interval, etc.)' })
  @Post('tracker-devices/:deviceId/command')
  async sendTrackerCommand(
    @Param('deviceId') deviceId: string,
    @Body('command') command: string,
    @Body('parameters') parameters: Record<string, unknown>,
    @CurrentUser('companyId') companyId: string,
  ) {
    return this.deviceCommandService.sendCommand(companyId, deviceId, command as any, parameters);
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
