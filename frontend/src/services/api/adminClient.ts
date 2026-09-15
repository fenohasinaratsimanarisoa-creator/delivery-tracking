import axios from 'axios';
import { getAdminToken, setAdminToken } from '../auth/adminTokenStore';
import { getApiBaseUrl } from './config';
import { fetchCsrfToken as fetchAdminCsrfToken, getCsrfHeaders } from './csrf';

// BUG CORRIGÉ (2026-09-16) : ce module maintenait AUPARAVANT sa PROPRE copie
// privée (csrfToken/csrfHmac) totalement indépendante de celle du client
// principal (api/client.ts), alors que les deux tirent le MÊME cookie
// `csrf-token` sur le MÊME domaine via le MÊME endpoint GET /auth/csrf-token.
// Conséquence concrète en prod : le compte Super-Admin est le même utilisateur
// que l'admin de sa propre société (ovatech) — dès qu'il utilisait /admin dans
// le même navigateur que son espace normal, chaque rafraîchissement CSRF d'un
// côté faisait tourner le cookie SANS mettre à jour la copie JS de l'autre
// côté, cassant TOUTES les mutations de ce côté-là de façon quasi permanente
// ("Une erreur temporaire est survenue" en boucle sur la soumission de preuve
// de paiement). Fix : une seule source de vérité CSRF (services/api/csrf.ts,
// déjà protégée par un verrou de déduplication) partagée par les deux clients.

function csrfHeaders(): Record<string, string> {
  return getCsrfHeaders();
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
