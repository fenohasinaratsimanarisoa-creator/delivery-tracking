import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken } from '../auth/tokenStore';
import { getApiBaseUrl } from './config';
import i18n from '../i18n/i18n';

let csrfToken: string | null = null;
let csrfHmac: string | null = null;

const apiBaseUrl = getApiBaseUrl();

export function getCsrfHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (csrfHmac) headers['X-CSRF-HMAC'] = csrfHmac;
  return headers;
}

export async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await axios.get(`${apiBaseUrl}/auth/csrf-token`, { withCredentials: true });
    csrfToken = res.data.csrfToken;
    csrfHmac = res.data.csrfHmac;
  } catch {
    // CSRF token fetch failure is non-fatal; mutations without CSRF may fail server-side
  }
}

const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
  withCredentials: true,
});

let refreshPromise: Promise<void> | null = null;

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.method && !['get', 'head', 'options'].includes(config.method) && config.headers) {
    if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
    if (csrfHmac) config.headers['X-CSRF-HMAC'] = csrfHmac;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.code === 'ECONNABORTED') {
      error.userMessage = i18n.t('api.error.timeout');
      return Promise.reject(error);
    }
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
        if (csrfToken && error.config.headers) {
          error.config.headers['X-CSRF-Token'] = csrfToken;
          error.config.headers['X-CSRF-HMAC'] = csrfHmac;
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
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const hadAuthHeader = !!error.config?.headers?.Authorization;
    if (!hadAuthHeader) {
      return Promise.reject(error);
    }

    error.config._retry = true;

    if (!refreshPromise) {
      refreshPromise = (async () => {
        await fetchCsrfToken();
        const headers: Record<string, string> = {};
        if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
        if (csrfHmac) headers['X-CSRF-HMAC'] = csrfHmac;
        const res = await axios.post(`${apiBaseUrl}/auth/refresh`, {}, { headers, withCredentials: true });
        setAccessToken(res.data.accessToken);
      })().catch(() => {
        setAccessToken(null);
        window.location.href = '/login';
      }).finally(() => { refreshPromise = null; });
    }

    try {
      await refreshPromise;
      const newToken = getAccessToken();
      if (newToken) {
        error.config.headers.Authorization = `Bearer ${newToken}`;
      }
      return api(error.config);
    } catch {
      return Promise.reject(error);
    }
  },
);

fetchCsrfToken();

export default api;
