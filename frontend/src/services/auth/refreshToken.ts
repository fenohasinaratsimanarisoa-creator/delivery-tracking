import axios from 'axios';
import { fetchCsrfToken, getCsrfHeaders } from '../api/csrf';
import { getApiBaseUrl } from '../api/config';
import { setAccessToken } from './tokenStore';

export interface RefreshOutcome {
  token: string | null;
  /** Raison de l'échec quand token est null : 'network' (timeout / sans réponse,
   *  ex. cold start serveur → on NE redirige PAS vers /login) ou 'expired'
   *  (rejet réel du serveur → session expirée). */
  reason: 'network' | 'expired';
}

// ── VERROU DE DÉDUPLICATION UNIQUE DU REFRESH JWT ─────────────────────────────
// C'est LE SEUL point d'entrée de rafraîchissement du token d'accès de toute l'app :
// l'intercepteur 401 d'api/client.ts (rafraîchissement réactif) et le timer proactif
// du WebSocket (socket.ts) partagent tous deux cette promesse. UN SEUL appel réseau
// /auth/refresh peut être en vol à un instant donné, quelle que soit la source qui
// l'a déclenché. Deux refresh concurrents sont interprétés par le backend comme une
// réutilisation de refresh token ("REUSE detected (possible theft)", auth.service.ts
// méthode refresh()) qui révoque la session entière — c'est la cause des déconnexions
// forcées ~toutes les 5 min en usage réel (le socket rafraîchit proactivement à
// l'approche de l'expiration pendant que l'intercepteur 401 rafraîchit réactivement
// sur les requêtes REST concurrentes).
let refreshPromise: Promise<RefreshOutcome> | null = null;

/** Renvoie le nouveau token, ou null en cas d'échec (usage socket.ts, UI). */
export function refreshAccessToken(): Promise<string | null> {
  return sharedRefresh().then((outcome) => outcome.token);
}

/** Renvoie le résultat détaillé (token + raison de l'échec) — usage client.ts. */
export function refreshAccessTokenOutcome(): Promise<RefreshOutcome> {
  return sharedRefresh();
}

function sharedRefresh(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<RefreshOutcome> {
  try {
    await fetchCsrfToken();
    const res = await axios.post(
      `${getApiBaseUrl()}/auth/refresh`,
      {},
      { headers: getCsrfHeaders(), withCredentials: true, timeout: 30000 },
    );
    const token: string | undefined = res.data?.accessToken;
    if (token) setAccessToken(token);
    return { token: token ?? null, reason: 'expired' };
  } catch (err: unknown) {
    const e = err as { code?: string; response?: unknown; request?: unknown };
    const isNetworkError = e.code === 'ECONNABORTED' || (!e.response && !!e.request);
    return { token: null, reason: isNetworkError ? 'network' : 'expired' };
  }
}
