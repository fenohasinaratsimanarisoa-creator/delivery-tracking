import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TrackingService } from './tracking.service';
import { UpdatePositionDto, BatchPositionDto } from './dto/update-position.dto';

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' },
})
export class TrackingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private driverSockets = new Map<string, string[]>();

  constructor(
    private trackingService: TrackingService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      client.emit('error', 'Missing token');
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        companyId: payload.companyId,
        firstName: payload.firstName || '',
        lastName: payload.lastName || '',
      };

      client.join(`company:${payload.companyId}`);

      if (payload.role === 'driver') {
        const sockets = this.driverSockets.get(payload.sub) || [];
        sockets.push(client.id);
        this.driverSockets.set(payload.sub, sockets);
        client.join(`driver:${payload.sub}`);
      }
    } catch {
      client.emit('error', 'Invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const user = client.data.user;
    if (user?.role === 'driver') {
      const sockets = this.driverSockets.get(user.id) || [];
      this.driverSockets.set(
        user.id,
        sockets.filter((s) => s !== client.id),
      );
      if (this.driverSockets.get(user.id)?.length === 0) {
        this.driverSockets.delete(user.id);
      }
    }
  }

  @SubscribeMessage('updatePosition')
  async handlePosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: UpdatePositionDto,
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    // Look up driver record from authenticated user
    const driver = await this.trackingService.findDriverByUserId(user.id);
    if (!driver) return;

    const position = await this.trackingService.savePosition(driver.id, dto);

    this.server.to(`company:${user.companyId}`).emit('positionUpdate', {
      driverId: driver.id,
      driverName: `${user.firstName} ${user.lastName}`,
      latitude: dto.latitude,
      longitude: dto.longitude,
      speed: dto.speed,
      timestamp: dto.timestamp,
      deliveryId: dto.deliveryId,
      vehicleId: dto.vehicleId,
    });

    return { event: 'positionSaved', data: { id: position.id } };
  }

  @SubscribeMessage('batchPosition')
  async handleBatchPosition(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: BatchPositionDto,
  ) {
    const user = client.data.user;
    if (!user || user.role !== 'driver') return;

    const driver = await this.trackingService.findDriverByUserId(user.id);
    if (!driver) return;

    const saved = await this.trackingService.saveBatch(driver.id, dto.positions);

    for (const pos of dto.positions) {
      this.server.to(`company:${user.companyId}`).emit('positionUpdate', {
        driverId: driver.id,
        driverName: `${user.firstName} ${user.lastName}`,
        ...pos,
      });
    }

    return { event: 'positionsSaved', data: { count: saved.length } };
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (!auth) return undefined;
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return auth;
  }
}
