import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '../auth/tokenStore';
import { getSocketBaseUrl } from '../api/config';

let socket: Socket | null = null;

function getNotificationSocket(): Socket {
  if (!socket) {
    socket = io(getSocketBaseUrl() + '/notifications', {
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

export function disconnectNotificationSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function useNotificationSocket(onNotification?: () => void): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    const s = getNotificationSocket();
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    const handleNotification = () => handlerRef.current?.();

    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.on('notification', handleNotification);
    if (s.connected) setConnected(true);

    return () => {
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.off('notification', handleNotification);
    };
  }, []);

  return { connected };
}