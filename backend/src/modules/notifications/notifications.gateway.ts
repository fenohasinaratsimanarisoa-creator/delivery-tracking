import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { WsAuthService } from '../../common/auth/ws-auth.service';
import { getCorsOrigins } from '../../config/cors';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: getCorsOrigins() },
})
@UseGuards(WsJwtGuard)
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private wsAuthService: WsAuthService) {}

  async handleConnection(client: Socket) {
    try {
      const user = await this.wsAuthService.verify(client);
      client.join(`company:${user.companyId}`);
      client.join(`user:${user.id}`);
    } catch {
      client.emit('error', 'Invalid token');
      client.disconnect();
    }
  }

  handleDisconnect(_client: Socket) {}

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, payload: { companyId: string; userId?: string }) {
    const user = client.data.user;
    if (!user) return;
    if (payload.companyId && payload.companyId === user.companyId) {
      client.join(`company:${payload.companyId}`);
    }
    if (payload.userId && payload.userId === user.id) {
      client.join(`user:${payload.userId}`);
    }
  }
}
