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

export async function fetchCsrfToken(): Promise<void> {
  try {
    const res = await axios.get(`${getApiBaseUrl()}/auth/csrf-token`, { withCredentials: true });
    csrfToken = res.data.csrfToken;
    csrfHmac = res.data.csrfHmac;
  } catch {
    // Échec non fatal : les mutations sans CSRF peuvent échouer côté serveur.
  }
}
