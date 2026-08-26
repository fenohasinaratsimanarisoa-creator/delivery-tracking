import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

/**
 * Authentifie le chemin d'envoi NATIF des positions
 * (POST /tracking/positions/native-batch, appelé par PositionUploadWorker.java).
 *
 * Accepte DEUX types de credential :
 *  - un access token normal (scope 'access' ou absent) — compatibilité avec le
 *    JS et avec les appareils pas encore passés au device token ;
 *  - un DEVICE TRACKING TOKEN (scope 'device_tracking', longue durée — voir
 *    AuthService.issueDeviceTrackingToken).
 *
 * POURQUOI ce guard existe (audit 2026-08-27, terrain réel) : JwtAuthGuard
 * (JwtStrategy) rejette tout scope !== 'access'. C'est voulu — le device token
 * ne doit JAMAIS authentifier une autre route que celle-ci. Ce guard est donc
 * le SEUL point d'entrée qui l'accepte, ce qui borne strictement son pouvoir :
 * pousser des positions GPS, rien d'autre.
 *
 * Révocation : mêmes vérifications que JwtStrategy (revoked:user:*,
 * revoked:session:* dans Redis), PLUS — pour un device token — la vérification
 * que la UserSession existe toujours en base. Un logout ou une révocation de
 * session coupe donc immédiatement le device token, malgré sa longue durée de
 * vie nominale.
 */
@Injectable()
export class DeviceTrackingAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const raw = authHeader.slice('Bearer '.length).trim();

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(raw, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const scope = payload.scope ?? 'access';
    if (scope !== 'access' && scope !== 'device_tracking') {
      throw new UnauthorizedException('Invalid token scope');
    }
    // Un jeton de plateforme (admin) n'a rien à faire sur ce chemin chauffeur.
    if (payload.type === 'platform_admin') {
      throw new UnauthorizedException('Invalid token type');
    }

    await this.assertNotRevoked(payload);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        companyId: true,
        isActive: true,
        firstName: true,
        lastName: true,
        company: { select: { deletedAt: true } },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    if (user.company?.deletedAt) {
      throw new UnauthorizedException('Company has been deleted — access revoked');
    }

    // Un device token vit 30 jours : sa session DOIT encore exister, sinon un
    // logout ne le couperait pas avant son expiration nominale.
    if (scope === 'device_tracking' && payload.sessionId) {
      const session = await this.prisma.userSession.findUnique({
        where: { id: payload.sessionId },
        select: { id: true, userId: true, expiresAt: true },
      });
      if (!session || session.userId !== user.id) {
        throw new UnauthorizedException('Session revoked');
      }
      if (session.expiresAt.getTime() < Date.now()) {
        throw new UnauthorizedException('Session expired');
      }
    }

    request.user = {
      ...user,
      type: 'user' as const,
      sessionId: payload.sessionId,
    };
    return true;
  }

  /** Mêmes clés de révocation que JwtStrategy — voir jwt.strategy.ts. */
  private async assertNotRevoked(payload: JwtPayload): Promise<void> {
    if (!payload.iat || !this.redis) return;

    const revokedAt = await this.redis.get(`revoked:user:${payload.sub}`);
    if (revokedAt && payload.iat < parseInt(revokedAt, 10)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    if (payload.sessionId) {
      const sessionRevokedAt = await this.redis.get(
        `revoked:session:${payload.sessionId}`,
      );
      if (sessionRevokedAt && payload.iat < parseInt(sessionRevokedAt, 10)) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }
  }
}
