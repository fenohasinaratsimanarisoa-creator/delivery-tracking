import axios from 'axios';
import { getAdminToken, setAdminToken } from '../auth/adminTokenStore';
import { getApiBaseUrl } from './config';

let csrfToken: string | null = null;
let csrfHmac: string | null = null;

// Le CsrfGuard est un APP_GUARD global : toute mutation (POST/PATCH/DELETE) exige
// le cookie csrf-token + les headers X-CSRF-Token/X-CSRF-HMAC. Le client admin
// doit donc les récupérer comme le client principal (api/client.ts), sinon toute
// action du dashboard (impersonate, toggle tenant, création d'admin) échoue avec
// 'Missing CSRF token'.
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

const adminApi = axios.create({
  baseURL: '/api/platform-admin',
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
    if (csrfToken) config.headers['X-CSRF-Token'] = csrfToken;
    if (csrfHmac) config.headers['X-CSRF-HMAC'] = csrfHmac;
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
        if (csrfToken && error.config.headers) {
          error.config.headers['X-CSRF-Token'] = csrfToken;
          error.config.headers['X-CSRF-HMAC'] = csrfHmac;
        }
        return adminApi(error.config);
      } catch {
        // Retry impossible — on laisse l'erreur d'origine remonter.
      }
    }

    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      try {
        const res = await axios.post('/api/auth/refresh', {}, {
          headers: { Authorization: `Bearer ${getAdminToken()}` },
          withCredentials: true,
        });
        const newToken = res.data.accessToken;
        setAdminToken(newToken);
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return adminApi(error.config);
      } catch {
        setAdminToken(null);
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(error);
  },
);

fetchAdminCsrfToken();

export default adminApi;
