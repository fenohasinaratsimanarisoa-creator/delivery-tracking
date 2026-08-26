import axios from 'axios';
import { fetchCsrfToken, getCsrfHeaders } from '../api/csrf';
import { getApiBaseUrl } from '../api/config';
import { setAccessToken } from './tokenStore';

export interface RefreshOutcome {
  token: string | null;
  /** Raison de l'échec quand token est null : 'network' (timeout, sans réponse,
   *  ou réponse d'erreur TRANSITOIRE — 403 CSRF, 429 throttle, 5xx serveur —
   *  → on NE redirige PAS vers /login, le refresh sera retenté) ou 'expired'
   *  (SEUL un 401 authentique de /auth/refresh = session réellement révoquée). */
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

// ── VERROU INTER-ONGLETS ──────────────────────────────────────────────────────
// Le verrou ci-dessus (refreshPromise) ne déduplique QUE dans l'instance JS d'UN
// onglet — chaque onglet a son propre module, donc son propre refreshPromise.
// Or le cookie refreshToken est PARTAGÉ par tous les onglets de l'origine, et la
// rotation atomique côté backend (auth.service.ts generateTokens) ne conserve
// qu'UN SEUL niveau d'historique (refresh_token_hash + previous_refresh_token_hash).
// Avec 3 onglets (ou plus) qui rafraîchissent à quelques ms d'écart en tenant
// TOUS le même cookie pré-rotation (ex. plusieurs onglets rouverts en même temps,
// ou leurs timers socket.ts arrivant à expiration ensemble), le 3e onglet ne
// correspond plus ni au hash courant ni au précédent → "REUSE detected" → la
// session ENTIÈRE est révoquée, déconnectant tous les onglets et l'app mobile
// (même compte, sessions séparées mais symptôme identique côté utilisateur).
// Web Locks API (navigator.locks) coordonne un verrou EXCLUSIF au niveau de
// l'origine, à travers tous les onglets/workers — pas seulement ce module JS.
// En sérialisant les appels réseau, le 2e onglet part APRÈS que le 1er ait reçu
// son Set-Cookie : il porte donc automatiquement le cookie déjà tourné, plus
// jamais l'ancien. Repli silencieux sur le comportement mono-onglet si l'API est
// absente (Safari < 15.4, anciens WebView) — pas de régression, juste pas de
// protection inter-onglets sur ces environnements.
const CROSS_TAB_LOCK_NAME = 'dt-auth-refresh';

function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}

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
    refreshPromise = runRefreshExclusive().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function runRefreshExclusive(): Promise<RefreshOutcome> {
  if (!hasWebLocks()) return doRefresh();
  // `await` aplatit une Promise<Promise<T>> — nécessaire ici : la signature de
  // LockManager.request() dans ce lib.dom.d.ts ne résout pas Awaited<T> et
  // typerait sinon Promise<Promise<RefreshOutcome>> (le callback renvoie une
  // Promise, pas la valeur elle-même).
  return await navigator.locks.request(CROSS_TAB_LOCK_NAME, () => doRefresh());
}

async function doRefresh(): Promise<RefreshOutcome> {
  try {
    await fetchCsrfToken();
    const postRefresh = async () =>
      axios.post(
        `${getApiBaseUrl()}/auth/refresh`,
        {},
        { headers: getCsrfHeaders(), withCredentials: true, timeout: 30000 },
      );

    let res;
    let csrfRetried = false;
    try {
      res = await postRefresh();
    } catch (firstErr: unknown) {
      // RETRY CSRF : si le POST échoue avec 403 CSRF (jeton CSRF obsolète,
      // cookie csrf-token pas encore posé par un GET concurrent), on
      // re-fetch le jeton CSRF et on retente UNE SEULE fois. Sans ce
      // retry, un GET /auth/csrf-token qui échoue silencieusement (cold
      // start, réseau mobile) laissait le POST avec des headers CSRF
      // vides → 403 → raison 'network' → le timer socket re-tente dans
      // 60 s, mais l'intercepteur 401 HTTP ne re-tente PAS → l'utilisateur
      // reste bloqué avec un access token expiré jusqu'à ce qu'une
      // requête HTTP déclenche un nouveau refresh.
      const firstStatus = (firstErr as { response?: { status?: number } })?.response?.status;
      if (firstStatus === 403 && !csrfRetried) {
        csrfRetried = true;
        await fetchCsrfToken();
        res = await postRefresh();
      } else {
        throw firstErr;
      }
    }

    const token: string | undefined = res.data?.accessToken;
    if (token) setAccessToken(token);
    return { token: token ?? null, reason: 'expired' };
  } catch (err: unknown) {
    const e = err as { code?: string; response?: { status?: number }; request?: unknown };
    const status = e.response?.status;
    // CRITIQUE POUR LA STABILITÉ DES SESSIONS : SEUL un 401 de /auth/refresh
    // signifie une session RÉELLEMENT révoquée/périmée (refresh token invalide,
    // croissance de session supprimée). Tout le reste est TRANSITOIRE et ne doit
    // JAMAIS déconnecter l'utilisateur :
    //  - 403 → jeton CSRF obsolète (le GET /auth/csrf-token a pu échouer sans
    //    réseau) ;
    //  - 429 → throttling du endpoint (5/min) — typique sur réseau mobile
    //    instable où socket + REST se chevauchent ;
    //  - 5xx → down Render / Postgres / cold start du conteneur ;
    //  - réseau/timeout → coupure mobile.
    // Avant ce correctif, tout échec HTTP non-2xx était classé 'expired' et
    // déclenchait immédiatement setAccessToken(null) + redirection /login avec le
    // message "Votre session a expiré" — l'utilisateur était déconnecté sans
    // raison sur un simple blip.
    const isGenuinelyExpired = status === 401;
    return { token: null, reason: isGenuinelyExpired ? 'expired' : 'network' };
  }
}
