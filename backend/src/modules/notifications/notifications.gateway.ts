import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const companyId = client.handshake.query.companyId as string;
    const userId = client.handshake.query.userId as string;
    if (companyId) {
      client.join(`company:${companyId}`);
    }
    if (userId) {
      client.join(`user:${userId}`);
    }
  }

  handleDisconnect(_client: Socket) {
    // rooms auto-leave on disconnect
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(
    client: Socket,
    payload: { companyId: string; userId?: string },
  ) {
    if (payload.companyId) {
      client.join(`company:${payload.companyId}`);
    }
    if (payload.userId) {
      client.join(`user:${payload.userId}`);
    }
  }
}
