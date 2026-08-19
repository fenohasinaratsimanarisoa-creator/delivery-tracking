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
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });

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
