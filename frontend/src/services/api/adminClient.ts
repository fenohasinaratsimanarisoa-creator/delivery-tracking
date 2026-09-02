import axios from 'axios';
import { getAdminToken, setAdminToken } from '../auth/adminTokenStore';
import { getApiBaseUrl } from './config';

let csrfToken: string | null = null;
let csrfHmac: string | null = null;

// Le CsrfGuard est un APP_GUARD global : toute mutation (POST/PATCH/DELETE) exige
// le cookie csrf-token + les headers X-CSRF-Token/X-CSRF-HMAC. Le client admin
// doit donc les récupérer comme le client principal (api/client.ts), sinon toute
// action du dashboard (impersonate, toggle tenant, création d'admin) — ET le
// refresh de session ci-dessous — échoue avec 'Missing CSRF token'.
// IMPORTANT : le token doit être fetché via le préfixe /api (getApiBaseUrl()),
// sinon la requête part vers le frontend (nginx ne proxy que /api/) et reçoit le
// HTML du SPA → le token reste null et le CSRF échoue en production.
export async function fetchAdminCsrfToken(): Promise<void> {
  try {
    const res = await axios.get(`${getApiBaseUrl()}/auth/csrf-token`, { withCredentials: true });
    csrfToken = res.data.csrfToken;
    csrfHmac = res.data.csrfHmac;
  } catch {
    // Non fatal : une 403 CSRF déclenchera un retry après nouveau fetch.
  }
}

function csrfHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (csrfToken) h['X-CSRF-Token'] = csrfToken;
  if (csrfHmac) h['X-CSRF-HMAC'] = csrfHmac;
  return h;
}

// ── VERROU DE DÉDUPLICATION DU REFRESH ADMIN ──────────────────────────────────
// Comme le flux utilisateur (services/auth/refreshToken.ts) : un seul appel
// réseau /platform-admin/auth/refresh en vol à la fois. Deux rafraîchissements
// concurrents (plusieurs requêtes 401 en parallèle, ou un onglet + un
// rechargement) seraient vus par le backend comme un rejeu de refresh token.
let adminRefreshPromise: Promise<string | null> | null = null;

/**
 * Rotation de la session admin via le cookie httpOnly admin_refreshToken.
 * Renvoie le nouvel access token, ou null si la session est réellement expirée.
 */
export function refreshAdminSession(): Promise<string | null> {
  if (!adminRefreshPromise) {
    adminRefreshPromise = doAdminRefresh().finally(() => {
      adminRefreshPromise = null;
    });
  }
  return adminRefreshPromise;
}

async function doAdminRefresh(): Promise<string | null> {
  const url = `${getApiBaseUrl()}/platform-admin/auth/refresh`;
  const call = () => axios.post(url, {}, { headers: csrfHeaders(), withCredentials: true });
  try {
    await fetchAdminCsrfToken();
    let res;
    try {
      res = await call();
    } catch (err) {
      // Retry unique sur 403 CSRF (jeton obsolète / cookie pas encore posé).
      if ((err as { response?: { status?: number } })?.response?.status === 403) {
        await fetchAdminCsrfToken();
        res = await call();
      } else {
        throw err;
      }
    }
    const token: string | undefined = res.data?.accessToken;
    if (token) {
      setAdminToken(token);
      return token;
    }
    return null;
  } catch {
    // 401 (session expirée), réseau, etc. : pas de session récupérable.
    return null;
  }
}

const adminApi = axios.create({
  baseURL: `${getApiBaseUrl()}/platform-admin`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true,
});

adminApi.interceptors.request.use((config) => {
  const token = getAdminToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.method && !['get', 'head', 'options'].includes(config.method) && config.headers) {
    Object.assign(config.headers, csrfHeaders());
  }
  return config;
});

adminApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Retry automatique sur 403 CSRF (token expiré / non encore chargé).
    if (
      error.response?.status === 403 &&
      typeof error.response?.data?.message === 'string' &&
      error.response.data.message.toLowerCase().includes('csrf') &&
      !error.config._csrfRetry
    ) {
      error.config._csrfRetry = true;
      try {
        await fetchAdminCsrfToken();
        if (error.config.headers) Object.assign(error.config.headers, csrfHeaders());
        return adminApi(error.config);
      } catch {
        // Retry impossible — on laisse l'erreur d'origine remonter.
      }
    }

    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const newToken = await refreshAdminSession();
      if (newToken) {
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return adminApi(error.config);
      }
      setAdminToken(null);
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  },
);

fetchAdminCsrfToken();

export default adminApi;
