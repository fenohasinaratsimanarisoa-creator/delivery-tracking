import axios from 'axios';
import { getApiBaseUrl } from './config';

let csrfToken: string | null = null;
let csrfHmac: string | null = null;

// État CSRF CENTRALISÉ : fetchCsrfToken()/getCsrfHeaders() sont les SEULS points de
// lecture/écriture du jeton CSRF, partagés par api/client.ts (intercepteurs Axios),
// services/auth/refreshToken.ts (refresh du JWT) et AuthContext.tsx (login/logout).
// Une seule source de vérité, aucun état csrfToken/csrfHmac désynchronisé entre flux.
export function getCsrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (csrfHmac) headers['X-CSRF-HMAC'] = csrfHmac;
  return headers;
}

// VERROU DE DÉDUPLICATION — même principe que refreshPromise dans refreshToken.ts :
// fetchCsrfToken() est appelée depuis plusieurs points indépendants (chargement du
// module, retry 403 de client.ts, retry 403 de refreshToken.ts) qui peuvent se
// déclencher à quelques ms d'intervalle. Sans verrou, deux appels concurrents
// tirent chacun leur propre GET /auth/csrf-token ; si les réponses arrivent dans
// le désordre, le second callback à s'exécuter écrase csrfToken/csrfHmac avec une
// paire dont le cookie posé par le navigateur ne correspond plus forcément (le
// Set-Cookie de la réponse la plus lente peut s'appliquer après celui de la plus
// rapide) — une requête en cours peut alors repartir avec un couple jeton/cookie
// dépareillé. Symptôme observé en prod : soumission d'une preuve de paiement en
// double-clic → 403 CSRF puis 401 sur le retry (2026-09-16).
let fetchPromise: Promise<void> | null = null;

export function fetchCsrfToken(): Promise<void> {
  if (!fetchPromise) {
    fetchPromise = doFetchCsrfToken().finally(() => {
      fetchPromise = null;
    });
  }
  return fetchPromise;
}

async function doFetchCsrfToken(): Promise<void> {
  try {
    const res = await axios.get(`${getApiBaseUrl()}/auth/csrf-token`, { withCredentials: true });
    csrfToken = res.data.csrfToken;
    csrfHmac = res.data.csrfHmac;
  } catch {
    // Échec non fatal : les mutations sans CSRF peuvent échouer côté serveur.
  }
}
