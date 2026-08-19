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

// Durée de mise en veille de l'onglet au-delà de laquelle on force une reconnexion
// propre au retour (Page Visibility API) : après un sommeil de l'ordinateur ou un
// long passage en arrière-plan, la connexion TCP peut être morte sans que socket.io
// l'ait encore détecté (les timers de ping sont throttlés en arrière-plan). Forcer
// disconnect()+connect() déclenche les handlers 'connect' de l'app (refetch complet
// de l'état via useDataUpdates, resubscribe des rooms par RealTimeMap) → le dispatcher
// rattrape tout ce qui a été manqué, sans attendre le prochain événement temps réel.
const VISIBLE_RECONNECT_THRESHOLD_MS = 10_000;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let lastHiddenAt = 0;

// True quand le serveur a rejeté la session (refresh échoué après un
// 'Invalid token') : on stoppe la boucle de reconnexion (économie batterie,
// plus de retries avec un jeton périmé) et on l'expose à l'UI via les
// listeners ci-dessous (TrackingStatus.sessionExpired).
let sessionExpired = false;

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Vrai si le serveur a REJETÉ notre authentification (par opposition à un
 * simple problème réseau). Les messages du backend sont variés — `'Invalid
 * token'` (gateway), `'Missing or invalid token'`, `'Invalid or expired
 * token'` (ws-auth.service.ts, notamment quand le JWT d'accès a expiré pendant
 * une reconnexion), `'Token has been revoked'`, `'User not found or inactive'`,
 * `'Company has been deleted'`. On matche donc sur les MOTS-CLÉS, pas sur une
 * sous-chaîne exacte : avant ce correctif, `'Invalid or expired token'` ne
 * contenait pas la chaîne `'Invalid token'` et le socket retentait indéfiniment
 * avec le jeton périmé → badge "Reconnexion…" permanent malgré un réseau OK,
 * jusqu'à ce qu'un 401 REST finisse par forcer une déconnexion.
 */
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

/**
 * S'abonne à l'état "session expirée" (le serveur a révoqué/rejeté la session et
 * le refresh a échoué). Renvoie la fonction de désabonnement. Consommé par
 * useDriverTracking pour alimenter TrackingStatus.sessionExpired.
 */
export function onSocketSessionExpired(cb: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(cb);
  return () => { sessionExpiredListeners.delete(cb); };
}

/**
 * 'error'/'connect_error' = "Invalid token" (émis par tracking.gateway.ts
 * handleConnection catch, ou rejet du handshake par ws-auth.service.ts).
 * NE PAS laisser socket.io retenter indéfiniment avec le même jeton périmé :
 *  - refresh immédiat (verrou partagé refreshToken.ts) ;
 *  - succès → reconnexion propre avec le nouveau jeton (nouveau handshake) ;
 *  - échec → stoppe la reconnexion et expose sessionExpired à l'UI.
 */
function handleInvalidToken(): void {
  void (async () => {
    const token = await refreshAccessToken();
    if (token) {
      sessionExpired = false;
      if (socket) {
        socket.auth = { token };
        socket.disconnect();
        socket.connect();
        scheduleTokenRefresh();
      }
    } else {
      sessionExpired = true;
      if (socket) socket.disconnect();
      sessionExpiredListeners.forEach((cb) => cb());
    }
  })();
}

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
      // ['websocket', 'polling'] : le WebSocket reste le transport préféré, mais si
      // l'upgrade échoue (réseaux mobiles dégradés, proxies d'opérateur qui bloquent
      // le handshake Upgrade), socket.io retombe automatiquement sur le long-polling
      // HTTP au lieu de rester déconnecté. Sans ce repli, les périodes de
      // déconnexion s'allongent et les positions s'accumulent dans la file IndexedDB
      // (offlineQueue.ts), plafonnée à 500 entrées avant suppression des plus
      // anciennes.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Délai maximal d'établissement de la connexion (handshake + upgrade) avant
      // abandon : les réseaux mobiles (3G/4G dégradées) peuvent mettre >20s à
      // établir un handshake complet ; le défaut de 20s coupait des connexions
      // légitimes qui étaient ensuite relancées inutilement.
      timeout: 45_000,
    });

    socket.on('disconnect', (reason) => {
      if (
        (reason === 'io server disconnect' || reason === 'transport close') &&
        getAccessToken() &&
        !sessionExpired
      ) {
        socket?.connect();
      }
    });

    // Rejet d'authentification du handshake par le serveur (ex. jeton expiré,
    // révoqué, session supprimée) : ne pas boucler en silence — refresh immédiat,
    // sinon sessionExpired exposé à l'UI. Matche par mots-clés (isAuthRejection)
    // pour couvrir TOUS les messages de WsAuthService/gateway.
    socket.on('error', (err: unknown) => {
      if (isAuthRejection(typeof err === 'string' ? { message: err } : err as { message?: string })) {
        handleInvalidToken();
      }
    });
    // Rejet du handshake pendant la phase de connexion (avant 'connect') :
    // socket.io-client l'expose comme 'connect_error' avec le message du serveur.
    socket.on('connect_error', (err: Error) => {
      if (isAuthRejection(err)) handleInvalidToken();
    });

    socket.io.on('reconnect_attempt', () => {
      if (socket) socket.auth = { token: getAccessToken() };
    });

    // À chaque (re)connexion, repart sur la bonne expiration du token courant.
    socket.on('connect', () => scheduleTokenRefresh());
    // Première programmation dès la création du socket.
    scheduleTokenRefresh();

    registerVisibilityHandler();
  }
  return socket;
}

let visibilityHandlerRegistered = false;

/**
 * Page Visibility API : au retour au premier plan après une mise en veille de
 * l'onglet / de l'ordinateur, force une reconnexion propre pour rattraper l'état
 * complet (le serveur a pu émettre des événements pendant la déconnexion). Ne se
 * déclenche que si la mise en arrière-plan a duré au-delà du seuil (10 s), pour
 * ne pas recréer la connexion à chaque changement d'onglet rapide.
 */
function registerVisibilityHandler(): void {
  if (visibilityHandlerRegistered || typeof document === 'undefined') return;
  visibilityHandlerRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      lastHiddenAt = Date.now();
      return;
    }
    // visible
    const s = socket;
    if (!s) return;
    const hiddenMs = lastHiddenAt > 0 ? Date.now() - lastHiddenAt : 0;
    if (hiddenMs > VISIBLE_RECONNECT_THRESHOLD_MS || !s.connected) {
      // Reconnexion propre : les handlers 'connect' (refetch complet des queries
      // dans useDataUpdates, resubscribe des rooms dans RealTimeMap, drainQueue
      // dans useDriverTracking) se déclenchent et rattrapent le manqué.
      s.disconnect();
      s.connect();
    }
    lastHiddenAt = 0;
  });
}

export function disconnectSocket(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  sessionExpired = false;
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export interface PositionUpdate {
  driverId?: string;
  driverName?: string;
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
