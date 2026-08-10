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
import { haversineDistance } from '../../common/geo/geo.utils';
import { computeConfidence } from '../../common/geo/gps-quality';
import { getCorsOrigins } from '../../config/cors';

@WebSocketGateway({
  cors: { origin: getCorsOrigins() },
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
    } catch {}
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
      if (await this.trackingService.isRateLimited(user.id)) {
        // Rate limiting : on rejette l'envoi, mais PAS silencieusement. Sans signal,
        // le client croirait sa position acceptée et la perdrait définitivement (elle
        // n'est ni sauvée ni mise en file). On réutilise l'événement positionRejected
        // du Bug n°10 avec un motif dédié, pour que sendPosition remette la position
        // en file d'attente locale (retentative via drainQueue).
        return { event: 'positionRejected', data: { reason: 'rate_limited' } };
      }

      if (dto.deliveryId) {
        try {
          await this.trackingService.verifyDriverAssignment(dto.deliveryId, user.id);
        } catch {
          this.logger.warn(
            `Position rejected: driver ${user.id} not assigned to delivery ${dto.deliveryId}`,
          );
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
        return;
      }

      let speed = dto.speed;
      if (!speed || speed <= 0) {
        const last = await this.trackingService.getLastPosition(dto.vehicleId);
        if (last) {
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
        return { event: 'positionRejected', data: { reason: 'rejected' } };
      }

      this.logger.log(
        `[POSITION] driver=${driver.id} lat=${dto.latitude.toFixed(6)} lng=${dto.longitude.toFixed(6)} speed=${speed?.toFixed(2)} heading=${dto.heading} delivery=${dto.deliveryId || 'none'} company=${user.companyId}`,
      );

      const confidence =
        dto.accuracy && dto.accuracy > 0
          ? computeConfidence(dto.accuracy, false, speed, dto.heading)
          : computeConfidence(undefined, false, speed, dto.heading);

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

      return { event: 'positionSaved', data: { id: position.id, suspect: position.suspect } };
    });
  }

  @SubscribeMessage('batchPosition')
  async handleBatchPosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: BatchPositionDto,
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    return CompanyScopedContext.run(user.companyId, async () => {
      const driver = await this.trackingService.findDriverByUserId(user.id);
      if (!driver) return;

      const saved = await this.trackingService.saveBatch(
        user.id,
        driver.id,
        dto.positions,
        user.companyId,
      );

      // Only broadcast positions that were actually saved
      const broadcasts = saved.map((pos: GpsPosition) => ({
        driverId: driver.id,
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

      return { event: 'positionsSaved', data: { count: saved.length } };
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
