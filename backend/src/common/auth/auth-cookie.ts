/**
 * Options des cookies d'authentification — logique PARTAGÉE (auth.controller a
 * historiquement ses propres constantes ; ce module sert le flux platform-admin
 * avec exactement la même règle).
 *
 * La sécurité (Secure, SameSite) suit le PROTOCOLE RÉEL du déploiement (APP_URL),
 * pas NODE_ENV : un VPS de prod sans TLS devant l'API (IP nue en http://) est un
 * cas légitime, et `SameSite=None; Secure` y est rejeté silencieusement par tous
 * les navigateurs (le cookie n'est jamais stocké).
 */
const primaryOrigin =
  process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0]?.trim() || '';
const isSecure = primaryOrigin.startsWith('https://');
const sameSite: 'none' | 'lax' = isSecure ? 'none' : 'lax';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export const ADMIN_REFRESH_COOKIE = 'admin_refreshToken';

export interface AdminRefreshCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  path: '/';
  maxAge?: number;
  domain?: string;
}

export function adminRefreshCookieOptions(
  cookieDomain?: string,
  persist = true,
): AdminRefreshCookieOptions {
  const opts: AdminRefreshCookieOptions = {
    httpOnly: true,
    secure: isSecure,
    sameSite,
    path: '/',
  };
  if (persist) opts.maxAge = SEVEN_DAYS_MS;
  if (cookieDomain) opts.domain = cookieDomain;
  return opts;
}
