import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '../auth/tokenStore';
import { refreshAccessToken } from '../auth/refreshToken';
import { getSocketBaseUrl } from '../api/config';

let socket: Socket | null = null;

// Même mécanique que services/socket/socket.ts : un rejet d'auth du handshake
// (jeton expiré pendant une reconnexion, révoqué...) doit déclencher un refresh
// au lieu de boucler indéfiniment sur un jeton périmé. Le refresh est DÉDUPLIQUÉ
// par le verrou partagé de refreshToken.ts (une seule requête /auth/refresh en
// vol pour toute l'app), donc pas de course multi-sockets.
function isAuthRejection(err: { message?: string } | null | undefined): boolean {
  if (!err?.message) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes('token') ||
    m.includes('jwt') ||
    m.includes('unauthorized') ||
    m.includes('revoked') ||
    m.includes('inactive')
  );
}

function getNotificationSocket(): Socket {
  if (!socket) {
    socket = io(getSocketBaseUrl() + '/notifications', {
      auth: (cb: (data: { token: string | null }) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect_error', (err: Error) => {
      if (!isAuthRejection(err)) return;
      void (async () => {
        const token = await refreshAccessToken();
        if (token && socket) {
          socket.auth = { token };
          socket.disconnect();
          socket.connect();
        }
      })();
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