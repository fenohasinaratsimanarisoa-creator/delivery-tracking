import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { UseGuards, UseFilters, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Server, Socket } from 'socket.io';
import { GpsPosition } from '@prisma/client';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { WsAuthService } from '../../common/auth/ws-auth.service';
import { TrackingService } from './tracking.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { UpdatePositionDto, BatchPositionDto } from './dto/update-position.dto';
import { DataUpdateBus, DataUpdateEvent } from '../../common/events/data-update.bus';
import { WsTrackingExceptionFilter } from '../../common/filters/ws-tracking-exception.filter';
import { CompanyScopedContext } from '../../common/tenant/company-scoped-context';
import { haversineDistance, isAccuracyTrustworthy } from '../../common/geo/geo.utils';
import { computeConfidence } from '../../common/geo/gps-quality';
import { getCorsOrigins } from '../../config/cors';

@WebSocketGateway({
  cors: { origin: getCorsOrigins() },
  // Ping/pong LENIENT : le défaut de socket.io (pingInterval 25 s / pingTimeout
  // 20 s) ferme une connexion légitime après ~45 s de silence — trop court pour
  // des réseaux mobiles momentanément lents (3G/4G dégradées, tunnels, zones
  // blanches en zone urbaine). Avec 35 s / 25 s, une connexion tolère ~60 s de
  // silence avant fermeture ; le client (reconnection: true, backoff 1→5 s) se
  // reconnecte seul dans tous les cas, mais on évite les fermetures à tort qui
  // sont perçues comme des "déconnexions" par le dispatcher.
  pingInterval: 35_000,
  pingTimeout: 25_000,
  // maxHttpBufferSize EXPLICITE : le défaut Engine.IO (1 Mo) suffit pour des
  // positions individuelles mais peut rejeter un rattrapage réseau volumineux
  // SANS diagnostic exploitable côté client. Le client découpe désormais en
  // chunks de ≤250 positions (~40 Ko par chunk en pratique), mais on laisse
  // une marge large pour les pics de taille de payload et les futures
  // augmentations de chunk : 5 Mo >> 250 positions × ~1 Ko/payload, transport
  // jamais rejeté pour cause de taille.
  maxHttpBufferSize: 5 * 1024 * 1024,
})
@UseGuards(WsJwtGuard)
@UseFilters(WsTrackingExceptionFilter)
export class TrackingGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TrackingGateway.name);
  private disconnectedDrivers = new Map<string, Date>();
  private driverCleanupTimer: ReturnType<typeof setInterval> | null = null;

  private dataUpdateListener: (event: DataUpdateEvent) => void;

  constructor(
    private trackingService: TrackingService,
    private wsAuthService: WsAuthService,
    private dataUpdateBus: DataUpdateBus,
    private deliveryProximityService: DeliveryProximityService,
  ) {
    this.dataUpdateListener = (event) => {
      if (event.targetUserId && event.entity === 'proximityAlert') {
        this.server?.to(`driver:${event.targetUserId}`).emit('proximityAlert', event.payload);
      }
      if (event.companyId) {
        this.server?.to(`company:${event.companyId}`).emit('dataUpdate', {
          entity: event.entity,
          action: event.action,
          ...(event.payload || {}),
        });
      }
    };
  }

  onModuleInit() {
    this.dataUpdateBus.on('dataUpdate', this.dataUpdateListener);
    this.driverCleanupTimer = setInterval(() => {
      const cutoff = Date.now() - 86_400_000;
      for (const [id, ts] of this.disconnectedDrivers) {
        if (ts.getTime() < cutoff) this.disconnectedDrivers.delete(id);
      }
    }, 3_600_000);
  }

  onModuleDestroy() {
    this.dataUpdateBus.off('dataUpdate', this.dataUpdateListener);
    if (this.driverCleanupTimer) clearInterval(this.driverCleanupTimer);
  }

  async handleConnection(client: Socket) {
    try {
      const user = await this.wsAuthService.verify(client);
      if (user.role === 'driver') {
        client.join(`driver:${user.id}`);
        this.disconnectedDrivers.delete(user.id);
        this.logger.log(`Driver connected: ${user.id} (${user.firstName} ${user.lastName})`);
        // CORRIGÉ (audit GPS 2026-08-28, B3) : les chauffeurs rejoignaient AUSSI
        // `company:<id>` et recevaient donc les positionUpdate/batchPositionUpdate
        // de TOUS les véhicules de l'entreprise — consommation de données mobiles
        // inutile sur le forfait du chauffeur, et exposition des positions de ses
        // collègues à son appareil. Un chauffeur n'a besoin que de sa propre room
        // `driver:<id>` (alertes de proximité qui lui sont destinées) ; il ne
        // consomme aucun flux de supervision.
        return;
      }
      if (user.companyId) {
        client.join(`company:${user.companyId}`);
        this.logger.log(`${user.role} joined company room: ${user.companyId}`);
      }
    } catch {
      client.emit('error', 'Invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    try {
      const user = client.data?.user;
      if (user?.role === 'driver' && user?.companyId) {
        this.disconnectedDrivers.set(user.id, new Date());
        this.server.to(`company:${user.companyId}`).emit('driverOffline', {
          driverId: user.id,
          timestamp: new Date().toISOString(),
        });
        this.logger.warn(`Driver ${user.id} disconnected`);
      }
    } catch (err) {
      this.logger.debug(`handleDisconnect best-effort cleanup failed: ${(err as Error).message}`);
    }
  }

  /**
   * Reçoit une position GPS brute du chauffeur et la persiste.
   *
   * ATTENTION : Le backend doit toujours recevoir les coordonnées GPS brutes non filtrées.
   * Le filtre de Kalman côté frontend (KalmanFilter.ts) lisse uniquement l'affichage client.
   * C'est sur ces données brutes que la détection de téléportation, les alertes de vitesse,
   * et les géofences sont évalués.
   */
  @SubscribeMessage('updatePosition')
  async handlePosition(@ConnectedSocket() client: Socket, @MessageBody() dto: UpdatePositionDto) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    return CompanyScopedContext.run(user.companyId, async () => {
      // Validation EXPLICITE dans le handler : le ValidationPipe global ne
      // s'applique PAS aux @SubscribeMessage (vérifié empiriquement) — sans
      // cela, des coordonnées invalides (lat 999, speed "abc", timestamp
      // illisible) atteignaient Prisma tel quel. La validation rejette le
      // payload (positionRejected explicite, jamais un silence qui ferait
      // rejouer le client), et STRIP les clés inconnues (whitelist) comme le
      // champ event envoyé par certaines versions de l'app mobile.
      const instance = plainToInstance(UpdatePositionDto, dto, {
        exposeUnsetFields: false,
        enableImplicitConversion: true,
      });
      const validationErrors = await validate(instance, {
        whitelist: true,
        skipMissingProperties: false,
      });
      if (validationErrors.length > 0) {
        const fields = validationErrors
          .map((e) => Object.keys(e.constraints || {}))
          .flat()
          .join(', ');
        this.logger.warn(`Position payload invalid (driver=${user.id}): ${fields}`);
        client.emit('positionRejected', { reason: 'invalid_payload' });
        return;
      }
      dto = instance;

      if (await this.trackingService.isRateLimited(user.id)) {
        // Rate limiting : on rejette l'envoi, mais PAS silencieusement. Sans signal,
        // le client croirait sa position acceptée et la perdrait définitivement (elle
        // n'est ni sauvée ni mise en file). On réutilise l'événement positionRejected
        // avec un motif dédié, pour que sendPosition remette la position en file
        // d'attente locale (retentative via drainQueue).
        // IMPORTANT : le client n'attend AUCUN ack socket.io (emit sans callback) —
        // l'acquittement ne remonte QUE par client.emit() explicite. Un "return
        // { event, data }" ne lui serait jamais transmis (perte GPS silencieuse).
        client.emit('positionRejected', { reason: 'rate_limited' });
        return;
      }

      if (dto.deliveryId) {
        try {
          await this.trackingService.verifyDriverAssignment(dto.deliveryId, user.id);
        } catch {
          this.logger.warn(
            `Position rejected: driver ${user.id} not assigned to delivery ${dto.deliveryId}`,
          );
          // Échec d'assignation : émission EXPLICITE du rejet, sinon le client
          // resterait bloqué sur isSendingRef jusqu'au timeout de secours (2s côté
          // app) pour une position qui ne sera jamais ni confirmée ni rejetée.
          client.emit('positionRejected', { reason: 'not_assigned' });
          return;
        }
      }

      const driver = await this.trackingService.findDriverByUserId(user.id);
      if (!driver) return;

      // Cross-tenant check: ensure the vehicle belongs to the user's company
      try {
        await this.trackingService.assertVehicleOwnership(dto.vehicleId, user.companyId);
      } catch {
        this.logger.warn(
          `Position rejected: vehicle ${dto.vehicleId} not owned by company ${user.companyId}`,
        );
        // Cross-tenant : émission EXPLICITE du rejet (même logique que not_assigned
        // ci-dessus — jamais de retour silencieux qui bloque le client 2-3s).
        client.emit('positionRejected', { reason: 'vehicle_mismatch' });
        return;
      }

      let speed = dto.speed;
      // Dérivation PRUDENTE de la vitesse (audit GPS 2026-08-28, C8) : cette
      // vitesse est persistée indistinctement d'une vitesse mesurée par le
      // mobile, puis relue par la RÈGLE VITESSE de computeFilteredDistance —
      // qui compte alors le segment EN ENTIER. Si les positions sont bruitées,
      // le raisonnement devient circulaire (le bruit fabrique une vitesse qui
      // valide son propre segment de bruit). On ne dérive donc que si les DEUX
      // extrémités sont assez précises.
      if ((!speed || speed <= 0) && isAccuracyTrustworthy(dto.accuracy)) {
        const last = await this.trackingService.getLastPosition(dto.vehicleId);
        if (last && isAccuracyTrustworthy(last.accuracy)) {
          const timeDiffSec = (new Date(dto.timestamp).getTime() - last.timestamp.getTime()) / 1000;
          if (timeDiffSec > 0) {
            const distance = haversineDistance(
              last.latitude,
              last.longitude,
              dto.latitude,
              dto.longitude,
            );
            speed = distance / timeDiffSec;
          }
        }
      }

      // Le WebSocket de l'app mobile est toujours une source 'phone'.
      // Persiste la vitesse RÉSOLUE (y compris le fallback haversine/Δt) et non le DTO
      // brut : sans cela, la RÈGLE VITESSE du rapport carburant (computeFilteredDistance
      // → MOVEMENT_SPEED_THRESHOLD_MS) retombait sur le filtre accuracy quand speed
      // restait null/undefined en base, sous-comptant la distance (bug 50km→10km).
      // Le DTO original reste intact (validation, logs, broadcast utilisent dto).
      const effectiveDto: UpdatePositionDto = { ...dto, speed };
      const position = await this.trackingService.savePosition(
        driver.id,
        effectiveDto,
        user.companyId,
        'phone',
      );
      if (!position) {
        // savePosition() a rejeté la position (véhicule désactivé, mal configuré…).
        // Renvoyer silencieusement empêchait le client de savoir que sa position a
        // été rejetée : il la considérait comme envoyée → perte GPS totale et
        // invisible pendant toute la session. On répond donc par un événement
        // d'échec explicite, même forme que le succès (positionSaved), avec un motif
        // générique : aucun détail interne ni cross-tenant ne fuite côté client
        // (la source de vérité détaillée reste les logs de savePosition côté serveur).
        // Émission explicite client.emit — jamais de valeur retournée (voir plus haut).
        client.emit('positionRejected', { reason: 'rejected' });
        return;
      }

      this.logger.log(
        `[POSITION] driver=${driver.id} lat=${dto.latitude.toFixed(6)} lng=${dto.longitude.toFixed(6)} speed=${speed?.toFixed(2)} heading=${dto.heading} delivery=${dto.deliveryId || 'none'} company=${user.companyId}`,
      );

      // P2 : suspect était codé en dur à false → la confiance affichée ignorait les
      // points de téléportation (contrairement au chemin batch). On propage position.suspect.
      const confidence =
        dto.accuracy && dto.accuracy > 0
          ? computeConfidence(dto.accuracy, position.suspect, speed, dto.heading)
          : computeConfidence(undefined, position.suspect, speed, dto.heading);

      const broadcast = {
        driverId: driver.id,
        driverName: `${user.firstName} ${user.lastName}`,
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: speed,
        heading: dto.heading,
        altitude: dto.altitude,
        accuracy: dto.accuracy,
        suspect: position.suspect,
        confidence,
        timestamp: dto.timestamp,
        deliveryId: dto.deliveryId,
        vehicleId: dto.vehicleId,
      };

      if (dto.deliveryId) {
        this.server.to(`delivery:${dto.deliveryId}`).emit('positionUpdate', broadcast);
      }
      this.server.to(`company:${user.companyId}`).emit('positionUpdate', broadcast);

      // Acquittement EXPLICITE via client.emit : le téléphone écoute
      // socket.once('positionSaved') pour libérer isSendingRef. Sans cette
      // émission, il reste bloqué jusqu'à son timeout de secours et ne peut plus
      // envoyer de positions (sous-comptage de distance jusqu'à 80-90%).
      client.emit('positionSaved', { id: position.id, suspect: position.suspect });
      return;
    });
  }

  @SubscribeMessage('batchPosition')
  async handleBatchPosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: BatchPositionDto & { batchId?: string },
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    // CORRÉLATION DE LOT (audit GPS 2026-08-28, A5 — perte de données) :
    // l'acquittement `positionsSaved` n'avait AUCUN identifiant. Le client
    // s'abonne via socket.once('positionsSaved') sans pouvoir savoir à quel lot
    // l'ack correspond : sur réseau lent, l'ack TARDIF d'un chunk A déjà en
    // timeout résolvait la promesse du chunk B en cours, qui était alors
    // supprimé d'IndexedDB SANS avoir été acquitté ni persisté. On renvoie
    // désormais le batchId fourni par le client dans TOUTES les réponses de ce
    // handler ; le client ignore tout ack dont le batchId ne correspond pas.
    const batchId = typeof dto?.batchId === 'string' ? dto.batchId : undefined;

    return CompanyScopedContext.run(user.companyId, async () => {
      // Rate limit anti-flood + validation parallèle + résolution driver + appel
      // saveBatch() : logique COMMUNE avec POST /tracking/positions/native-batch
      // (TrackingController), extraite dans TrackingService.validateAndSaveBatch
      // pour que les deux chemins appliquent EXACTEMENT le même garde-fou anti-flood
      // — sinon le chemin REST natif deviendrait un contournement du rate limit.
      const result = await this.trackingService.validateAndSaveBatch(
        user.id,
        user.companyId,
        dto?.positions,
      );

      // AUCUN acquittement positionsSaved n'est émis sur rate-limit : le client
      // conserve ses positions en file IndexedDB (flushQueue ne purge que sur
      // résolution) et retente après son timeout (~5 s) — backoff naturel, zéro
      // perte de données.
      if (result.status === 'rate_limited') {
        client.emit('positionsRejected', { reason: 'rate_limited', kind: 'batch', batchId });
        return;
      }
      // BUG CORRIGÉ (audit GPS 2026-08-28, A4 — perte de données) : ce cas
      // émettait `positionsSaved`, que le client traite comme un ACQUITTEMENT —
      // flushQueue purge alors la file IndexedDB (deletePositions) alors que
      // RIEN n'a été persisté. Le chemin natif équivalent renvoie 422 depuis le
      // 2026-08-27 précisément pour éviter cette perte : les deux chemins sont
      // désormais cohérents. Un profil Driver non résolvable est TRANSITOIRE
      // (compte en cours de provisionnement, désaffectation) — le client doit
      // conserver ses positions et retenter.
      if (result.status === 'no_driver') {
        client.emit('positionsRejected', { reason: 'no_driver', kind: 'batch', batchId });
        return;
      }
      // Lot réellement vide : rien à conserver, acquittement légitime.
      if (result.status === 'empty') {
        client.emit('positionsSaved', { count: 0, batchId });
        return;
      }

      const { saved, driverId } = result;
      const rejected = result.rejected ?? [];

      if (rejected.length > 0) {
        // Positions définitivement invalides : le client DOIT les retirer de sa
        // file (les retenter à l'identique échouerait indéfiniment), mais il en
        // est informé explicitement pour pouvoir les compter/alerter — jamais
        // une disparition silencieuse.
        client.emit('positionsInvalid', { batchId, rejected });
      }

      if (result.validatedCount === 0) {
        client.emit('positionsSaved', { count: 0, batchId });
        return;
      }

      // Only broadcast positions that were actually saved
      const broadcasts = saved.map((pos: GpsPosition) => ({
        driverId,
        driverName: `${user.firstName} ${user.lastName}`,
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: pos.speed,
        heading: pos.heading,
        altitude: pos.altitude,
        accuracy: pos.accuracy,
        suspect: pos.suspect,
        confidence: pos.accuracy
          ? computeConfidence(pos.accuracy, pos.suspect ?? false, pos.speed ?? undefined)
          : computeConfidence(undefined, pos.suspect ?? false, pos.speed ?? undefined),
        timestamp: pos.timestamp instanceof Date ? pos.timestamp.toISOString() : pos.timestamp,
        deliveryId: pos.deliveryId ?? undefined,
        vehicleId: pos.vehicleId,
      }));

      const rooms = new Set<string>();
      for (const pos of saved) {
        if (pos.deliveryId) {
          rooms.add(`delivery:${pos.deliveryId}`);
        }
      }
      rooms.add(`company:${user.companyId}`);

      for (const room of rooms) {
        this.server.to(room).emit('batchPositionUpdate', broadcasts);
      }

      // Acquittement EXPLICITE du batch (même mécanisme que positionSaved) : le
      // client n'utilise pas de callback ack socket.io, seule une émission explicite
      // est reçue par son socket.once('positionsSaved'). batchId permet au client
      // de vérifier que cet ack concerne bien le lot qu'il attend (voir A5).
      client.emit('positionsSaved', { count: saved.length, batchId });
      return;
    });
  }

  /**
   * Reçoit un snooze d'alerte de proximité du chauffeur (après dismiss côté app).
   * On ne fait confiance à AUCUN deliveryId/vehicleId envoyé par le client : on
   * revérifie que le chauffeur authentifié est bien assigné à la livraison, puis
   * on dérive le vehicleId de sa session (véhicule du chauffeur). Le snooze
   * serveur ainsi écrit évite que le serveur réémette proximityAlert à chaque
   * position GPS reçue tant que le véhicule reste dans le rayon.
   * Les clients mobiles qui n'envoient pas ce message gardent un comportement
   * fonctionnel (alertes réémises), juste moins optimisé.
   */
  /**
   * Batterie critique (niveau ≤ 20 %) signalée par l'app mobile (foreground service
   * natif) : crée une notification dashboard + enregistre la dernière position, pour
   * que le dispatcher voie la cause probable d'une interruption plutôt qu'un silence.
   */
  @SubscribeMessage('batteryCritical')
  async handleBatteryCritical(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      vehicleId?: string;
      deliveryId?: string;
      level?: number;
      latitude?: number;
      longitude?: number;
      timestamp?: number;
    },
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;
    try {
      await this.trackingService.reportBatteryCritical(user.id, {
        level: body?.level,
        vehicleId: body?.vehicleId,
        deliveryId: body?.deliveryId,
        latitude: body?.latitude,
        longitude: body?.longitude,
      });
    } catch (err) {
      this.logger.warn(
        `Battery critical report failed (driver=${user.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  @SubscribeMessage('snoozeProximityAlert')
  async handleSnoozeProximityAlert(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { deliveryId?: string; escalationLevel?: number },
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    const deliveryId = body?.deliveryId;
    if (!deliveryId || typeof deliveryId !== 'string') return;

    try {
      await this.trackingService.verifyDriverAssignment(deliveryId, user.id);
    } catch {
      this.logger.warn(
        `Snooze proximity rejected: driver ${user.id} not assigned to delivery ${deliveryId}`,
      );
      return;
    }

    const driver = await this.trackingService.findDriverByUserId(user.id);
    if (!driver?.vehicleId) return;

    const escalationLevel =
      typeof body?.escalationLevel === 'number' && body.escalationLevel >= 0
        ? Math.floor(body.escalationLevel)
        : 0;

    await this.deliveryProximityService.snoozeProximity(
      deliveryId,
      driver.vehicleId,
      escalationLevel,
    );
  }

  @SubscribeMessage('subscribeToDelivery')
  async handleSubscribeToDelivery(
    @ConnectedSocket() client: Socket,
    @MessageBody() deliveryId: string,
  ) {
    const user = client.data.user;
    if (!user || user.role === 'driver') return;

    if (typeof deliveryId !== 'string' || !deliveryId) {
      client.emit('error', 'Invalid delivery ID');
      return;
    }

    try {
      await this.trackingService.getDeliveryInfo(deliveryId, user.companyId);
    } catch {
      client.emit('error', 'Delivery not found or access denied');
      return;
    }

    client.join(`delivery:${deliveryId}`);
    return { event: 'subscribed', data: { deliveryId } };
  }

  @SubscribeMessage('unsubscribeFromDelivery')
  async handleUnsubscribeFromDelivery(
    @ConnectedSocket() client: Socket,
    @MessageBody() deliveryId: string,
  ) {
    const user = client.data.user;
    if (!user || user.role === 'driver') return;

    client.leave(`delivery:${deliveryId}`);
    return { event: 'unsubscribed', data: { deliveryId } };
  }

  @SubscribeMessage('subscribeToCompany')
  async handleSubscribeToCompany(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    if (!user || user.role === 'driver') return;

    client.join(`company:${user.companyId}`);
    return { event: 'subscribed', data: { companyId: user.companyId } };
  }

  @SubscribeMessage('unsubscribeFromCompany')
  async handleUnsubscribeFromCompany(@ConnectedSocket() client: Socket) {
    const user = client.data.user;
    if (!user || user.role === 'driver') return;

    client.leave(`company:${user.companyId}`);
    return { event: 'unsubscribed', data: { companyId: user.companyId } };
  }

  broadcastDataUpdate(companyId: string, type: string, payload?: Record<string, unknown>) {
    this.server.to(`company:${companyId}`).emit('dataUpdate', { type, ...payload });
  }

  broadcastToCompany(companyId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`company:${companyId}`).emit(event, data);
  }

  sendToDriver(userId: string, event: string, data: Record<string, unknown>) {
    this.server.to(`driver:${userId}`).emit(event, data);
  }
}
