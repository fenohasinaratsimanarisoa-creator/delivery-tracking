import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  HttpCode,
  HttpStatus,
  HttpException,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DeviceTrackingAuthGuard } from '../../common/guards/device-tracking-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ApiKeyOrJwtGuard } from '../api-keys/guards/api-key-or-jwt.guard';
import { ApiKeyScope } from '../api-keys/decorators/api-key-scope.decorator';
import { TraccarBridgeService } from './traccar-bridge.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import { UpdateTrackingReliabilityDto } from './dto/update-tracking-reliability.dto';
import { BatchPositionDto } from './dto/update-position.dto';
import { SmsRelayPositionDto } from './dto/sms-relay-position.dto';

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
    @Query('page') page = '1',
    @Query('limit') limit = '200',
  ) {
    // Clamp strict (audit 2026-08-25 G.3) : `?limit=10000000` chargeait toute la
    // trace en mémoire (DoS applicatif) et une page négative produisait un skip
    // négatif → exception Prisma → 500.
    const safePage = Math.max(1, Math.floor(Number(page) || 1));
    const safeLimit = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 200)));
    return this.trackingService.getPositionsByDelivery(
      deliveryId,
      companyId,
      safePage,
      safeLimit,
    );
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
  @Roles('driver')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mettre à jour la fiabilité du tracking GPS-téléphone du chauffeur authentifié',
    description:
      "Appelé par l'app mobile (useDriverTracking.ts) à chaque changement détecté de batteryOptimizationIgnored/deviceOem. Réservé au rôle driver — le statut mis à jour est TOUJOURS celui du chauffeur authentifié (résolu depuis le token, jamais un id fourni par le client) : impossible de modifier le statut d'un autre chauffeur.",
  })
  @Patch('reliability-status')
  updateReliabilityStatus(
    @CurrentUser('id') userId: string,
    @Body() body: UpdateTrackingReliabilityDto,
  ) {
    return this.trackingService.updateTrackingReliability(userId, body.status);
  }

  // DeviceTrackingAuthGuard (et NON JwtAuthGuard) : ce chemin est appelé par le
  // worker natif Android, qui utilise un credential LONGUE DURÉE de scope
  // 'device_tracking' — volontairement rejeté par JwtStrategy partout ailleurs.
  // Voir device-tracking-auth.guard.ts et AuthService.issueDeviceTrackingToken :
  // sans ce credential, le worker perdait toute authentification 15 min après le
  // dernier passage du JS (WebView gelée en veille) et cessait SILENCIEUSEMENT
  // d'envoyer — la panne exacte remontée sur le terrain. Un access token normal
  // reste accepté (compatibilité).
  @UseGuards(DeviceTrackingAuthGuard, CompanyScopeGuard, RolesGuard)
  @Roles('driver')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Pousser un lot de positions GPS via HTTP natif, indépendant du WebSocket',
    description:
      "Point d'entrée REST pour PositionUploadWorker (Android, WorkManager) : permet d'envoyer les positions accumulées en SQLite natif (LocationQueueDb) même quand le socket.io JS n'est pas connecté (WebView gelée/tuée par l'OS). Applique EXACTEMENT le même garde-fou anti-flood et la même logique de sauvegarde que le chemin WebSocket 'batchPosition' — voir TrackingService.validateAndSaveBatch, factorisé entre les deux chemins pour ne jamais diverger.",
  })
  // BUG CORRIGÉ (audit 2026-08-26, confirmé par test réel sur appareil : 135
  // positions capturées en SQLite natif, 0 jamais synchronisées, 403 "Missing
  // CSRF token" reproduit via curl avec le token natif exact) : ce endpoint
  // est appelé par PositionUploadWorker.java (HttpURLConnection natif), qui
  // n'a et ne peut avoir AUCUN moyen d'obtenir un jeton CSRF — celui-ci
  // provient exclusivement de GET /auth/csrf-token, un flux JS/cookie que le
  // code natif n'exécute jamais. La protection CSRF n'a de toute façon aucun
  // sens ici : ce endpoint n'est authentifié QUE par Bearer JWT
  // (Authorization), jamais par cookie — un attaquant cross-site ne peut pas
  // faire porter un Authorization arbitraire par le navigateur de la victime
  // (contrairement à un cookie), donc aucune requête cross-site forgée ne
  // peut jamais l'atteindre. Ce bug rendait Phase 4 (upload natif indépendant
  // du JS) totalement non fonctionnelle depuis sa création — jamais détecté
  // faute de test Phase 5 (protocole réel sur appareil) exécuté avant ce jour.
  @SkipCsrf()
  @HttpCode(HttpStatus.OK)
  @Post('positions/native-batch')
  async saveNativeBatch(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Body() dto: BatchPositionDto,
  ): Promise<{ saved: number; duplicates: number }> {
    const result = await this.trackingService.validateAndSaveBatch(
      userId,
      companyId,
      dto?.positions,
    );

    if (result.status === 'rate_limited') {
      // Même comportement que handleBatchPosition (gateway) : rejet PROPRE, rien
      // n'est marqué côté client (PositionUploadWorker ne fait markSynced() que
      // sur 200 OK) — les positions restent en file SQLite locale pour retry au
      // prochain cycle WorkManager (backoff exponentiel natif), jamais de perte
      // silencieuse.
      throw new HttpException({ saved: 0, duplicates: 0 }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (result.status === 'empty') {
      // Lot vide envoyé par erreur (ne devrait pas arriver côté natif, qui ne
      // déclenche jamais avec une file vide) : rien à synchroniser, 200 légitime.
      return { saved: 0, duplicates: 0 };
    }
    if (result.status === 'no_driver') {
      // BUG CORRIGÉ (audit 2026-08-27) : renvoyer 200/{saved:0} ici était une
      // PERTE DE DONNÉES SILENCIEUSE. PositionUploadWorker.java ne lit JAMAIS
      // le corps de la réponse — il appelle markSynced() (suppression locale
      // définitive) dès qu'il voit un statut 2xx, quel qu'il soit. Un batch
      // VALIDÉ mais rejeté faute de profil Driver résolvable (compte pas
      // encore provisionné, désaffectation en cours) était donc supprimé de la
      // file native SANS jamais avoir été persisté côté serveur — perte
      // définitive. Un statut non-2xx force le natif à conserver les
      // positions (Result.retry() n'est PAS déclenché ici côté worker, mais
      // seul le chemin 2xx marque synced — voir doWork()) : elles restent en
      // file, retentées au cycle suivant, jusqu'à ce qu'un profil Driver
      // existe (ou survivent jusqu'à la purge par ancienneté, dernier
      // recours, jamais silencieuse).
      throw new HttpException({ saved: 0, duplicates: 0 }, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // duplicates = positions validées mais NON persistées par saveBatch(). En
    // pratique, pour ce chemin natif (vehicleId toujours celui de la session de
    // tracking en cours), la quasi-totalité provient du garde-fou d'unicité
    // (vehicleId, timestamp) — skipDuplicates dans saveBatch, INCHANGÉ ici.
    const duplicates = Math.max(0, result.validatedCount - result.saved.length);
    return { saved: result.saved.length, duplicates };
  }

  /**
   * Ingestion d'une position relayée par SMS (audit terrain 2026-08-27) —
   * canal de secours zéro-connectivité : un chauffeur sans data ni WiFi envoie
   * sa position par SMS à un téléphone-passerelle fixe (au bureau, avec sa
   * propre connexion internet), qui relaie chaque SMS reçu ici. Authentifié
   * par clé API dédiée (scope 'tracking:sms-relay') — le téléphone-passerelle
   * n'est lié à AUCUN chauffeur en particulier, il relaie pour toute la
   * flotte : une clé API scopée à l'entreprise, pas un token de session
   * chauffeur, est le bon modèle d'authentification ici.
   *
   * Pas de vehicleId dans le body (voir SmsRelayPositionDto) : résolu
   * côté service à partir du numéro d'envoi (TrackingService.ingestSmsRelayPosition).
   */
  @UseGuards(ApiKeyOrJwtGuard)
  @ApiKeyScope('tracking:sms-relay')
  @ApiHeader({
    name: 'X-API-Key',
    required: true,
    description: 'Clé API scopée tracking:sms-relay, configurée sur le téléphone-passerelle',
  })
  @ApiOperation({
    summary: 'Ingestion relais SMS — canal de secours sans data/WiFi',
    description:
      "Point d'entrée pour le téléphone-passerelle (GatewaySmsReceiver, Android) : relaie une position reçue par SMS quand le chauffeur émetteur n'avait ni data ni WiFi.",
  })
  @HttpCode(HttpStatus.OK)
  @Post('positions/sms-relay')
  async ingestSmsRelay(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: SmsRelayPositionDto,
  ): Promise<{ status: string }> {
    const result = await this.trackingService.ingestSmsRelayPosition(companyId, dto);
    if (result.status === 'no_driver_match' || result.status === 'rejected') {
      // Même politique que 'no_driver' sur le chemin natif-batch (audit
      // 2026-08-27) : un statut non-2xx signale explicitement l'échec au lieu
      // d'un 200 trompeur — la passerelle peut logger/alerter au lieu de
      // croire à tort que la position a été attribuée à un chauffeur.
      throw new HttpException({ status: result.status }, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return result;
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
  @Public()
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
