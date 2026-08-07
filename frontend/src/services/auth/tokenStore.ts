import { parseToken } from '../jwt';

let _accessToken: string | null = null;

const SESSION_KEY = 'dt_access_token';

export function setAccessToken(token: string | null) {
  _accessToken = token;
  if (token) {
    try { sessionStorage.setItem(SESSION_KEY, token); } catch {}
  } else {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
}

export function getAccessToken(): string | null {
  if (_accessToken) return _accessToken;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      _accessToken = stored;
      return stored;
    }
  } catch {}
  return null;
}

/** Décode le claim "exp" (secondes) d'un JWT et le convertit en timestamp ms. */
export function getTokenExpiryMs(token: string): number | null {
  const payload = parseToken(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  const ms = payload.exp * 1000;
  return Number.isFinite(ms) ? ms : null;
}

/** Timestamp d'expiration (ms) du token d'accès courant, ou null si absent/invalide. */
export function getAccessTokenExpiryMs(): number | null {
  const token = getAccessToken();
  return token ? getTokenExpiryMs(token) : null;
}
