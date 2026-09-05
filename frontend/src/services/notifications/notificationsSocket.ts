import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken, getAccessTokenExpiryMs } from '../auth/tokenStore';
import { refreshAccessToken } from '../auth/refreshToken';
import { getSocketBaseUrl } from '../api/config';

let socket: Socket | null = null;

// Même mécanisme proactif que services/socket/socket.ts (voir son commentaire
// détaillé) : sans lui, ce socket ne rafraîchissait le token qu'en réaction à un
// 'connect_error' — un onglet resté ouvert plus de JWT_ACCESS_EXPIRATION (15 min)
// SANS coupure réseau restait "connecté" avec un jeton périmé, silencieusement
// incapable de recevoir de nouvelles notifications temps réel jusqu'à la
// prochaine reconnexion accidentelle.
const REFRESH_MARGIN_MS = 60_000;
const REFRESH_RETRY_MS = 60_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTokenRefresh(retryAfterMs?: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  let delay: number;
  if (retryAfterMs !== undefined) {
    delay = retryAfterMs;
  } else {
    const expiry = getAccessTokenExpiryMs();
    const remaining = expiry !== null ? expiry - Date.now() : 0;
    delay = remaining > 0 ? Math.max(0, remaining - REFRESH_MARGIN_MS) : REFRESH_RETRY_MS;
  }
  refreshTimer = setTimeout(handleRefreshTick, delay);
}

async function handleRefreshTick(): Promise<void> {
  const refreshed = await refreshAccessToken();
  if (refreshed && socket && socket.connected) {
    socket.auth = { token: getAccessToken() };
    socket.disconnect();
    socket.connect();
    scheduleTokenRefresh();
  } else {
    scheduleTokenRefresh(REFRESH_RETRY_MS);
  }
}

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
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 45_000,
    });

    socket.on('connect_error', (err: Error) => {
      if (!isAuthRejection(err)) return;
      void (async () => {
        const token = await refreshAccessToken();
        if (token && socket) {
          socket.auth = { token };
          socket.disconnect();
          socket.connect();
          scheduleTokenRefresh();
        }
      })();
    });

    socket.on('connect', () => scheduleTokenRefresh());
    scheduleTokenRefresh();
  }
  return socket;
}

export function disconnectNotificationSocket(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
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