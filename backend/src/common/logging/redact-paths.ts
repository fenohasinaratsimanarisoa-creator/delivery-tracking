/**
 * Champs masqués dans les journaux pino (API ET worker — une seule liste pour qu'elles
 * ne divergent plus).
 *
 * - Cookie de session entrant et Set-Cookie sortant : le Set-Cookie (refreshToken/
 *   csrf-token fraîchement émis par /auth/login, /auth/refresh…) écrivait le JWT en clair
 *   dans les logs (constaté en prod le 2026-08-26). pino-http expose les en-têtes de
 *   réponse via res.headers.
 * - En-têtes secrets (audit A→Z 2026-09-24 : x-csrf-token / x-csrf-hmac apparaissaient en
 *   clair dans chaque erreur HTTP journalisée) : jetons CSRF, clé d'API, signature des
 *   webhooks Mobile Money.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-csrf-hmac"]',
  'req.headers["x-api-key"]',
  'req.headers["x-mm-signature"]',
  'res.headers["set-cookie"]',
  'body.password',
  'body.token',
  'body.accessToken',
  'body.refreshToken',
  'body.secret',
];

export const LOG_REDACT = { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' };
