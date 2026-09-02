import type { Response } from 'express';

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

interface AdminRefreshCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'none' | 'lax';
  path: '/';
  maxAge?: number;
  domain?: string;
}

function adminRefreshCookieOptions(
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

export function setAdminRefreshCookie(
  res: Response,
  refreshToken: string,
  cookieDomain?: string,
): void {
  // clear host-only d'abord (garde-fou COOKIE_DOMAIN, comme auth.controller).
  res.clearCookie(ADMIN_REFRESH_COOKIE, { path: '/' });
  res.cookie(ADMIN_REFRESH_COOKIE, refreshToken, adminRefreshCookieOptions(cookieDomain));
}

export function clearAdminRefreshCookie(res: Response, cookieDomain?: string): void {
  res.clearCookie(ADMIN_REFRESH_COOKIE, adminRefreshCookieOptions(cookieDomain, false));
}

/**
 * Pose le cookie de refresh admin si présent dans le résultat, et retourne le
 * corps de réponse SANS le refreshToken (il ne doit jamais transiter par le
 * body — il y était exposé pour rien).
 */
export function finishAdminAuth<T extends { refreshToken?: string }>(
  res: Response,
  result: T,
  cookieDomain?: string,
): Omit<T, 'refreshToken'> {
  if (result.refreshToken) setAdminRefreshCookie(res, result.refreshToken, cookieDomain);
  const safe = { ...result };
  delete safe.refreshToken;
  return safe;
}
