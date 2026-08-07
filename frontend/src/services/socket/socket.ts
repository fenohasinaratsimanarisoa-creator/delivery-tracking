import { io, Socket } from 'socket.io-client';
import { getAccessToken, getAccessTokenExpiryMs } from '../auth/tokenStore';
import { refreshAccessToken } from '../auth/refreshToken';
import { getSocketBaseUrl } from '../api/config';

let socket: Socket | null = null;

// POURQUOI CE MÉCANISME EST NÉCESSAIRE :
// Le token JWT du WebSocket est capturé UNE seule fois au handshake initial —
// client.handshake.auth.token, lu par extractToken() dans ws-auth.service.ts —
// et n'est JAMAIS relu en cours de connexion. Or JWT_ACCESS_EXPIRATION vaut
// 15 min (backend/.env) : une session socket de plus de 15 min sans coupure
// réseau verrait tous ses "updatePosition"/"batchPosition" rejetés
// silencieusement par WsJwtGuard, alors que socket.connected reste true côté
// client (aucune file d'attente locale, positions perdues). On rafraîchit donc
// le token AVANT son expiration, puis on force une reconnexion propre pour
// refaire le handshake avec le nouveau token — sans attendre un 401 HTTP ni une
// reconnexion accidentelle.
const REFRESH_MARGIN_MS = 60_000; // 60 s de marge de sécurité avant l'expiration
const REFRESH_RETRY_MS = 60_000; // nouvelle tentative après un échec de refresh

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Programme un rafraîchissement du token au plus tard REFRESH_MARGIN_MS avant
 * son expiration. Après un échec (retryAfterMs fourni), on repart sur un délai
 * fixe de 60 s indépendant de l'expiration, pour éviter une boucle de retries
 * immédiats.
 */
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
    // Nouveau token obtenu et stocké : reconnexion propre → nouveau handshake
    // qui capture le token à jour. Le gap disconnect/connect est immédiat ;
    // les éventuels emits pendant cette fenêtre repartent en file (socket.connected
    // passe à false l'espace d'un instant).
    socket.disconnect();
    socket.connect();
    scheduleTokenRefresh();
  } else {
    // Échec du refresh : on ne force PAS de reconnexion (le mécanisme réactif
    // reconnect_attempt / client.ts gère l'échec) ; on retente dans 60 s.
    scheduleTokenRefresh(REFRESH_RETRY_MS);
  }
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketBaseUrl(), {
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

    // À chaque (re)connexion, repart sur la bonne expiration du token courant.
    socket.on('connect', () => scheduleTokenRefresh());
    // Première programmation dès la création du socket.
    scheduleTokenRefresh();
  }
  return socket;
}

export function disconnectSocket(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
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
