import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { Socket } from 'socket.io';

export interface WsAuthenticatedUser {
  id: string;
  email?: string;
  role: string;
  companyId: string;
  firstName: string;
  lastName: string;
}

export class WsAuthError extends Error {
  constructor(
    message: string,
    public readonly code: 'TOKEN_MISSING' | 'TOKEN_INVALID' | 'INVALID_PAYLOAD',
  ) {
    super(message);
    this.name = 'WsAuthError';
  }
}

/**
 * Durée de validité du cache de vérification par socket (audit GPS 2026-08-28,
 * B2). WsJwtGuard appelle verify() sur CHAQUE @SubscribeMessage : à raison
 * d'une position toutes les 3 s par chauffeur, cela faisait 1 requête DB +
 * 2 lectures Redis par position (≈ 1 000 requêtes/min pour 50 chauffeurs), rien
 * que pour l'authentification.
 *
 * Ce cache ne relâche AUCUNE garantie de sécurité :
 *  - il est porté par le socket lui-même (client.data), donc jamais partagé
 *    entre connexions ni entre utilisateurs ;
 *  - la signature ET l'expiration du JWT sont revérifiées à CHAQUE message
 *    (jwtService.verify n'est pas caché) — un token expiré est refusé
 *    immédiatement ;
 *  - seules les lectures de RÉVOCATION (Redis) et l'état du compte (DB) sont
 *    mises en cache, pour 10 s au maximum. Une révocation coupe donc le socket
 *    en moins de 10 s au lieu d'instantanément : très en deçà de la durée de
 *    vie de l'access token (15 min), et le handshake initial reste toujours
 *    vérifié sans cache.
 */
const WS_AUTH_CACHE_TTL_MS = 10_000;

interface WsAuthCacheEntry {
  user: WsAuthenticatedUser;
  token: string;
  checkedAt: number;
}

@Injectable()
export class WsAuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async verify(client: Socket): Promise<WsAuthenticatedUser> {
    const token = this.extractToken(client);
    if (!token) {
      throw new WsAuthError('Invalid token: missing', 'TOKEN_MISSING');
    }

    try {
      // Signature + expiration : TOUJOURS revérifiées, jamais mises en cache.
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });

      // SCOPE : seul un access token général ouvre un socket. Un device token
      // (`scope: 'device_tracking'`, 30 j, réservé à POST
      // /tracking/positions/native-batch) porte `sub` + `companyId` et passerait
      // sinon la vérification ci-dessous — il donnerait alors accès au flux live
      // complet pendant 30 jours. Même règle que JwtStrategy (HTTP) et
      // DeviceTrackingAuthGuard.
      if (payload.scope && payload.scope !== 'access') {
        throw new WsAuthError('Invalid token: wrong scope', 'TOKEN_INVALID');
      }
      // Un jeton de plateforme (admin) n'a rien à faire sur le socket chauffeur.
      if (payload.type === 'platform_admin') {
        throw new WsAuthError('Invalid token: wrong type', 'TOKEN_INVALID');
      }

      // Cache court des contrôles COÛTEUX (révocation Redis + état DB) — voir
      // WS_AUTH_CACHE_TTL_MS. Invalidé si le token présenté change.
      const cached = (client.data as { authCache?: WsAuthCacheEntry }).authCache;
      if (
        cached &&
        cached.token === token &&
        Date.now() - cached.checkedAt < WS_AUTH_CACHE_TTL_MS
      ) {
        client.data.user = cached.user;
        return cached.user;
      }

      if (!payload.sub || !payload.companyId) {
        throw new WsAuthError('Invalid token: malformed payload', 'INVALID_PAYLOAD');
      }

      // Même contrôle de révocation que JwtStrategy (HTTP) : un logout ou une
      // révocation de session (revoked:session / revoked:user) doit couper le
      // socket immédiatement, pas seulement à l'expiration du token.
      if (payload.iat && this.redis) {
        try {
          const userRevokedAt = await this.redis.get(`revoked:user:${payload.sub}`);
          if (userRevokedAt && payload.iat < parseInt(userRevokedAt, 10)) {
            throw new WsAuthError('Invalid token: revoked', 'TOKEN_INVALID');
          }
          if (payload.sessionId) {
            const sessionRevokedAt = await this.redis.get(`revoked:session:${payload.sessionId}`);
            if (sessionRevokedAt && payload.iat < parseInt(sessionRevokedAt, 10)) {
              throw new WsAuthError('Invalid token: revoked', 'TOKEN_INVALID');
            }
          }
        } catch (err) {
          if (err instanceof WsAuthError) throw err;
          // Erreur Redis (indisponible) : on ne bloque pas le handshake,
          // la vérification DB ci-dessous reste la garantie principale.
        }
      }

      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
          companyId: true,
          firstName: true,
          lastName: true,
          isActive: true,
          company: { select: { deletedAt: true } },
        },
      });

      if (!dbUser || !dbUser.isActive) {
        throw new WsAuthError('Invalid token: user inactive', 'TOKEN_INVALID');
      }

      if (dbUser.company?.deletedAt) {
        throw new WsAuthError('Invalid token: company deleted', 'TOKEN_INVALID');
      }

      const user: WsAuthenticatedUser = {
        id: dbUser.id,
        email: dbUser.email || undefined,
        role: dbUser.role,
        companyId: dbUser.companyId,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      };

      client.data.user = user;
      (client.data as { authCache?: WsAuthCacheEntry }).authCache = {
        user,
        token,
        checkedAt: Date.now(),
      };
      return user;
    } catch (err) {
      if (err instanceof WsAuthError) throw err;
      // JWT expiré, signature invalide, payload corrompu : message UNIFIÉ avec le
      // préfixe "Invalid token:" — le client (socket.ts isAuthRejection) se base
      // sur ce préfixe/mots-clés pour déclencher le refresh au lieu de boucler.
      throw new WsAuthError('Invalid token: expired or invalid', 'TOKEN_INVALID');
    }
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (!auth) return undefined;
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return auth;
  }
}
