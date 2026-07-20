import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' },
})
export class NotificationsGateway {
  @WebSocketServer()
  server!: Server;
}
