import axios from 'axios';
import { fetchCsrfToken, getCsrfHeaders } from '../api/client';
import { getApiBaseUrl } from '../api/config';
import { setAccessToken } from './tokenStore';

// Rafraîchit le token d'accès via la MÊME route POST /auth/refresh que le
// mécanisme réactif d'api/client.ts (intercepteur 401), mais factorisé ici pour
// être réutilisable par le rafraîchissement PROACTIF du WebSocket (socket.ts)
// sans dupliquer la logique. Renvoie le nouveau token, ou null en cas d'échec.
// En cas de session réellement expirée, c'est le mécanisme réactif de client.ts
// (redirect /login) qui reste responsable de la déconnexion — pas celui-ci.
let refreshPromise: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<string | null> {
  try {
    await fetchCsrfToken();
    const res = await axios.post(
      `${getApiBaseUrl()}/auth/refresh`,
      {},
      { headers: getCsrfHeaders(), withCredentials: true, timeout: 15000 },
    );
    const token: string | undefined = res.data?.accessToken;
    if (token) setAccessToken(token);
    return token ?? null;
  } catch {
    return null;
  }
}
