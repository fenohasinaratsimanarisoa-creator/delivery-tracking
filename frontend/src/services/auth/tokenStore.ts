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
