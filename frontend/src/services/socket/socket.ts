import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('accessToken');
    socket = io('/', {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        socket?.connect();
      }
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
  timestamp: string;
  deliveryId: string;
  vehicleId: string;
}
