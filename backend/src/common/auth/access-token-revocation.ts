import Redis from 'ioredis';

/**
 * Révocation des ACCESS TOKENS encore vivants (≤ 15 min) via Redis. Les clés
 * `revoked:user:<id>` / `revoked:session:<id>` sont lues par JwtStrategy,
 * WsAuthService, DeviceTrackingAuthGuard et ApiKeyOrJwtGuard : un token émis
 * AVANT le cutoff (payload.iat < cutoff) est refusé.
 *
 * Historiquement, seule la déconnexion self-service (AuthController) posait ces
 * clés. Résultat : un mot de passe changé/réinitialisé supprimait les refresh
 * tokens mais laissait un access token volé actif jusqu'à 15 min. Ce module
 * centralise l'opération pour que TOUT changement de posture de sécurité
 * (logout, reset, changement de mot de passe, révocation de session) coupe
 * aussi les access tokens.
 *
 * `cutoff = now + 1` : payload.iat est en SECONDES. Si émission, révocation et
 * requête tombent dans la même seconde, `iat < now` serait faux et laisserait
 * passer un token pourtant émis avant la révocation. `now + 1` garantit
 * qu'aucun token existant ne survit (un token émis juste après, iat >= now+1,
 * reste valide).
 */
export function accessTokenTtlSeconds(jwtAccessExpiration: string | undefined): number {
  const raw = jwtAccessExpiration || '15m';
  const match = /^(\d+)([smhd])$/.exec(raw);
  if (!match) return 900;
  const value = parseInt(match[1], 10);
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multiplier[match[2]] || 60);
}

export async function revokeUserAccessTokens(
  redis: Redis | null,
  userId: string,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return;
  const cutoff = Math.floor(Date.now() / 1000) + 1;
  try {
    await redis.set(`revoked:user:${userId}`, String(cutoff), 'EX', Math.max(ttlSeconds, 1));
  } catch {
    // Best-effort : une panne Redis ne doit pas faire échouer le reset de mot de
    // passe lui-même (les refresh tokens sont déjà supprimés en base).
  }
}

export async function revokeSessionAccessTokens(
  redis: Redis | null,
  sessionId: string,
  ttlSeconds: number,
): Promise<void> {
  if (!redis) return;
  const cutoff = Math.floor(Date.now() / 1000) + 1;
  try {
    await redis.set(`revoked:session:${sessionId}`, String(cutoff), 'EX', Math.max(ttlSeconds, 1));
  } catch {
    // Best-effort — voir revokeUserAccessTokens.
  }
}
