import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken } from '../auth/tokenStore';
import { refreshAccessTokenOutcome } from '../auth/refreshToken';
import { fetchCsrfToken, getCsrfHeaders } from './csrf';
import { getApiBaseUrl } from './config';
import i18n from '../i18n/i18n';

const apiBaseUrl = getApiBaseUrl();

const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
  withCredentials: true,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.method && !['get', 'head', 'options'].includes(config.method) && config.headers) {
    Object.assign(config.headers, getCsrfHeaders());
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // ── Auto-retry unique (1 seule tentative, 3s délai) sur erreurs réseau ──
    // Un cold start ne doit jamais forcer un logout.
    const isNetworkError =
      error.code === 'ECONNABORTED' ||
      (!error.response && error.request);

    if (isNetworkError && !error.config._networkRetry) {
      error.config._networkRetry = true;
      await new Promise((r) => setTimeout(r, 3000));
      return api(error.config);
    }

    // ── ECONNABORTED après retry : le serveur est en train de se réveiller ──
    if (error.code === 'ECONNABORTED') {
      error.userMessage = i18n.t('api.error.waking');
      return Promise.reject(error);
    }

    // ── Aucune réponse après retry : problème réseau côté client ──
    if (!error.response) {
      error.userMessage = i18n.t('api.error.network');
      return Promise.reject(error);
    }

    const status = error.response?.status;
    const errMsg = error.response?.data?.message || '';

    if (status === 403 && errMsg.toLowerCase().includes('csrf') && !error.config._csrfRetry) {
      error.config._csrfRetry = true;
      try {
        await fetchCsrfToken();
        if (error.config.headers) {
          Object.assign(error.config.headers, getCsrfHeaders());
        }
        return api(error.config);
      } catch {
        return Promise.reject(error);
      }
    }

    if (error.response?.status !== 401 || error.config._retry) {
      if (status === 429) error.userMessage = i18n.t('api.error.rateLimit');
      else if (status >= 500) error.userMessage = i18n.t('api.error.server');
      return Promise.reject(error);
    }

    const isRefreshRequest = error.config.url?.includes('/auth/refresh');
    if (isRefreshRequest) {
      setAccessToken(null);
      try { sessionStorage.setItem('dt_auth_error', 'session_expired'); } catch {}
      // Flux Google OAuth : pendant la finalisation du callback (#accessToken=…),
      // un 401 du refresh est ATTENDU — le cookie refreshToken posé par le
      // callback est host-only sur l'origine API, pas sur l'origine web.
      // Rediriger ici détruirait la page avant que AuthCallbackPage ne
      // consomme le hash. On laisse la page finaliser la session.
      const isOAuthCallback =
        window.location.pathname === '/auth/callback' && /[#&]accessToken=/.test(window.location.hash);
      if (!isOAuthCallback) {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }

    const hadAuthHeader = !!error.config?.headers?.Authorization;
    if (!hadAuthHeader) {
      return Promise.reject(error);
    }

    error.config._retry = true;

    // ── Refresh UNIFIÉ avec le verrou partagé de refreshToken.ts ──
    // L'intercepteur 401 réactif et le timer proactif du socket passent par LE
    // MÊME refreshPromise : un seul /auth/refresh en vol à un instant donné, quel
    // que soit le déclencheur. Le résultat distingue un échec réseau (cold start
    // serveur → message 'waking', PAS de redirection) d'un rejet réel du serveur
    // (session expirée → nettoyage local + redirection /login).
    try {
      const outcome = await refreshAccessTokenOutcome();
      if (outcome.token) {
        error.config.headers.Authorization = `Bearer ${outcome.token}`;
        return api(error.config);
      }
      if (outcome.reason === 'network') {
        // Refresh timeout / sans réponse (cold start) → on NE redirige PAS vers /login.
        (error as Record<string, unknown>).userMessage = i18n.t('api.error.waking');
        return Promise.reject(error);
      }
      // Refresh authentiquement échoué → session expirée.
      setAccessToken(null);
      try { sessionStorage.setItem('dt_auth_error', 'session_expired'); } catch {}
      window.location.href = '/login';
      return Promise.reject(error);
    } catch (refreshErr: unknown) {
      // Propager le message 'waking' si le refresh a échoué par timeout
      const re = refreshErr as Record<string, unknown> | undefined;
      if (re?.userMessage) {
        (error as Record<string, unknown>).userMessage = re.userMessage;
      }
      return Promise.reject(error);
    }
  },
);

fetchCsrfToken();

export default api;
