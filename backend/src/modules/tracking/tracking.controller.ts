import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
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
import { TraccarBridgeService } from './traccar-bridge.service';

@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly traccarBridgeService: TraccarBridgeService,
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
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List vehicles currently in GPS silence (no position for > threshold)',
    description:
      "Vue temps réel de TOUS les véhicules actifs avec leur durée de silence GPS (depuis la dernière position reçue), le seuil d'alerte par source (phone 5 min / traceur 10 min), et la dernière position connue. Permet de vérifier d'un coup d'œil si un véhicule ne transmet plus — alerte détectée automatiquement par le moniteur serveur (notification dashboard + journal).",
  })
  @Get('silences')
  getTrackingSilences(@CurrentUser('companyId') companyId: string) {
    return this.trackingService.getTrackingSilences(companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('driver')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Signaler une interruption non volontaire du tracking (app tuée / fermée manuellement)',
    description:
      "Appelé par l'app mobile au lancement quand le marqueur natif d'interruption est présent (service tué par le système, force-stop partiel détecté par le watchdog). Crée une notification dashboard immédiate 'Chauffeur X : tracking interrompu à HH:MM' — jamais un silence découvert a posteriori.",
  })
  @Post('report-interruption')
  reportInterruption(
    @CurrentUser('id') userId: string,
    @Body()
    body: { interruptedAt?: string; reason?: string; deliveryId?: string; vehicleId?: string },
  ) {
    return this.trackingService.reportTrackingInterruption(userId, body);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('driver')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Signaler un niveau de batterie critique (le suivi va s'interrompre)",
    description:
      "Appelé par l'app mobile (socket ou HTTP) quand le foreground service détecte une batterie ≤ 20 %. Crée une notification dashboard + enregistre la dernière position connue : le dispatcher voit la cause probable de l'interruption.",
  })
  @Post('report-battery-critical')
  reportBatteryCritical(
    @CurrentUser('id') userId: string,
    @Body()
    body: {
      level?: number;
      vehicleId?: string;
      deliveryId?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    return this.trackingService.reportBatteryCritical(userId, body);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Rapport de fiabilité du tracking par véhicule (couverture GPS %)',
    description:
      "% du temps de livraison avec position GPS valide reçue, par véhicule/chauffeur, sur la période (défaut 30 jours). Permet de mesurer objectivement la fiabilité obtenue et d'identifier un chauffeur/téléphone à problème récurrent plutôt que d'accuser le système à tort.",
  })
  @Get('reliability')
  getTrackingReliability(
    @CurrentUser('companyId') companyId: string,
    @Query('days') days?: string,
  ) {
    const d = days ? parseInt(days, 10) : 30;
    return this.trackingService.getTrackingReliability(
      companyId,
      Number.isFinite(d) && d > 0 ? d : 30,
    );
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Archiver les positions GPS avant une date' })
  @Post('archive')
  async archivePositions(
    @Body('before') before: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    // Validation EXPLICITE de la date : une chaîne non-ISO devenait
    // `Invalid Date`, contournait le garde "48h minimum" (comparaison triviale
    // avec Invalid Date) et lançait un 500/UNIQUE. 400 explicite à la place.
    const beforeDate = new Date(before);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('`before` must be a valid ISO-8601 date');
    }
    const count = await this.trackingService.archivePositionsBefore(beforeDate, companyId);
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
  @ApiOperation({ summary: 'Get Traccar bridge connection status' })
  @Get('traccar-devices')
  async listTraccarDevices() {
    return this.traccarBridgeService.getStatus();
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('admin', 'dispatcher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Test if a Traccar device is receiving positions' })
  @Get('traccar-devices/:deviceId/test')
  async testTraccarDevice(
    @Param('deviceId') deviceId: string,
    @CurrentUser('companyId') companyId: string,
  ) {
    const lastPos = await this.trackingService.getLastPositionByTraccarId(deviceId, companyId);
    const now = Date.now();
    if (!lastPos) {
      return {
        status: 'never_connected',
        deviceId,
        message: 'No position received for this device',
      };
    }
    const elapsedMin = (now - lastPos.timestamp.getTime()) / 60000;
    if (elapsedMin < 5) {
      return {
        status: 'receiving',
        deviceId,
        lastPosition: lastPos.timestamp,
        elapsedMin: Math.round(elapsedMin),
      };
    }
    return {
      status: 'stale',
      deviceId,
      lastPosition: lastPos.timestamp,
      elapsedMin: Math.round(elapsedMin),
      message: `Last position received ${Math.round(elapsedMin)} minutes ago`,
    };
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

  // Les endpoints tracker-devices (chaîne B) ont été supprimés.
  // Le lien entre véhicule et traceur se fait via POST /vehicles/:vehicleId/link-traccar.

  @ApiOperation({ summary: 'Get tracking info via public token (no auth required)' })
  @Get('public/:token')
  async getPublicTrackingInfo(@Param('token') token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
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
