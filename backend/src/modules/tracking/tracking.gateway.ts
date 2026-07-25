import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { UseGuards, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { WsAuthService } from '../../common/auth/ws-auth.service';
import { TrackingService } from './tracking.service';
import { UpdatePositionDto, BatchPositionDto } from './dto/update-position.dto';
import { DataUpdateBus } from '../../common/events/data-update.bus';

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' },
})
@UseGuards(WsJwtGuard)
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(TrackingGateway.name);
  private disconnectedDrivers = new Map<string, Date>();

  constructor(
    private trackingService: TrackingService,
    private wsAuthService: WsAuthService,
    private dataUpdateBus: DataUpdateBus,
  ) {
    this.dataUpdateBus.on('dataUpdate', (event) => {
      if (event.companyId) {
        this.server.to(`company:${event.companyId}`).emit('dataUpdate', {
          entity: event.entity,
          action: event.action,
          ...(event.payload || {}),
        });
      }
    });
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

  @SubscribeMessage('updatePosition')
  async handlePosition(@ConnectedSocket() client: Socket, @MessageBody() dto: UpdatePositionDto) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

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

    let speed = dto.speed;
    if (!speed || speed <= 0) {
      const last = await this.trackingService.getLastPosition(dto.vehicleId);
      if (last) {
        const timeDiffSec = (new Date(dto.timestamp).getTime() - last.timestamp.getTime()) / 1000;
        if (timeDiffSec > 0) {
          const distance = this.trackingService.haversineDistance(
            last.latitude,
            last.longitude,
            dto.latitude,
            dto.longitude,
          );
          speed = distance / timeDiffSec;
        }
      }
    }

    const position = await this.trackingService.savePosition(driver.id, dto, user.companyId);
    if (!position) return;

    this.logger.log(
      `[POSITION] driver=${driver.id} lat=${dto.latitude.toFixed(6)} lng=${dto.longitude.toFixed(6)} speed=${speed?.toFixed(2)} heading=${dto.heading} delivery=${dto.deliveryId || 'none'} company=${user.companyId}`,
    );

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
      timestamp: dto.timestamp,
      deliveryId: dto.deliveryId,
      vehicleId: dto.vehicleId,
    };

    if (dto.deliveryId) {
      this.server.to(`delivery:${dto.deliveryId}`).emit('positionUpdate', broadcast);
    }
    this.server.to(`company:${user.companyId}`).emit('positionUpdate', broadcast);

    return { event: 'positionSaved', data: { id: position.id, suspect: position.suspect } };}

  @SubscribeMessage('batchPosition')
  async handleBatchPosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: BatchPositionDto,
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    const driver = await this.trackingService.findDriverByUserId(user.id);
    if (!driver) return;

    const saved = await this.trackingService.saveBatch(
      user.id,
      driver.id,
      dto.positions,
      user.companyId,
    );

    const broadcasts = dto.positions.map((pos) => ({
      driverId: driver.id,
      driverName: `${user.firstName} ${user.lastName}`,
      ...pos,
    }));

    const rooms = new Set<string>();
    for (const pos of dto.positions) {
      rooms.add(`delivery:${pos.deliveryId}`);
    }
    rooms.add(`company:${user.companyId}`);

    for (const room of rooms) {
      this.server.to(room).emit('batchPositionUpdate', broadcasts);
    }

    return { event: 'positionsSaved', data: { count: saved.length } };
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
}
