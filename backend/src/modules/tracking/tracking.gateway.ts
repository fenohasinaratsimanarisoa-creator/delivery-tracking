import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:5173' },
})
export class TrackingGateway {
  @WebSocketServer()
  server!: Server;
}
