import { io, Socket } from 'socket.io-client';
import { getAccessToken } from '../auth/tokenStore';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('disconnect', (reason) => {
      if ((reason === 'io server disconnect' || reason === 'transport close') && getAccessToken()) {
        socket?.connect();
      }
    });

    socket.io.on('reconnect_attempt', () => {
      if (socket) socket.auth = { token: getAccessToken() };
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export interface PositionUpdate {
  driverId: string;
  driverName: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  accuracy?: number;
  suspect?: boolean;
  confidence?: number;
  timestamp: string;
  deliveryId?: string;
  vehicleId: string;
}
