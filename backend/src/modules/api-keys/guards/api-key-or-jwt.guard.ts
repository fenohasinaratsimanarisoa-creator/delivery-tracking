import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { API_KEY_SCOPE_KEY } from '../decorators/api-key-scope.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (apiKey) {
      return this.validateApiKey(request, apiKey, context);
    }

    if (request.user) {
      return true;
    }

    // Voie JWT Bearer si ni clé API ni user pré-positionné.
    const authHeader = request.headers.authorization as string;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return this.validateJwt(request, authHeader.slice(7).trim());
    }

    throw new UnauthorizedException(
      'Authentication required. Provide JWT Bearer token or X-API-Key header.',
    );
  }

  /**
   * Valide un access token avec EXACTEMENT les mêmes garde-fous que JwtStrategy
   * (jwt.strategy.ts). AVANT, cette voie faisait un simple jwtService.verify()
   * puis posait request.user, SANS vérifier :
   *  - le scope → un device_tracking token (30 jours) était accepté comme un
   *    access token plein, défaisant tout son périmètre restreint ;
   *  - la révocation Redis (revoked:user / revoked:session) → un token d'une
   *    session déconnectée restait accepté jusqu'à expiration ;
   *  - user.isActive / company.deletedAt → utilisateur désactivé ou entreprise
   *    supprimée gardaient l'accès ;
   *  - payload.type → un token platform_admin passait aussi.
   */
  private async validateJwt(request: any, token: string): Promise<boolean> {
    let payload: JwtPayload & { iat?: number };
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired JWT token');
    }

    // Scope strict : SEUL un access token (scope 'access' ou absent) ouvre une
    // route métier. device_tracking / 2fa_pending / public-tracking : refusés.
    if (payload.scope && payload.scope !== 'access') {
      throw new UnauthorizedException('Invalid token scope');
    }
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

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      type: 'user' as const,
      sessionId: payload.sessionId,
    };
    return true;
  }

  /** Mêmes clés de révocation que JwtStrategy / DeviceTrackingAuthGuard. */
  private async assertNotRevoked(payload: JwtPayload & { iat?: number }): Promise<void> {
    if (!payload.iat || !this.redis) return;
    const revokedAt = await this.redis.get(`revoked:user:${payload.sub}`);
    if (revokedAt && payload.iat < parseInt(revokedAt, 10)) {
      throw new UnauthorizedException('Token has been revoked');
    }
    if (payload.sessionId) {
      const sessionRevokedAt = await this.redis.get(`revoked:session:${payload.sessionId}`);
      if (sessionRevokedAt && payload.iat < parseInt(sessionRevokedAt, 10)) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }
  }

  private async validateApiKey(
    request: any,
    apiKey: string,
    context: ExecutionContext,
  ): Promise<boolean> {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const keyRecord = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash, isActive: true },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!keyRecord) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const scopes = keyRecord.scopes as string[];
    const requiredScope = this.reflector.getAllAndOverride<string>(API_KEY_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScope && !scopes.includes(requiredScope)) {
      throw new UnauthorizedException(`API key missing required scope: ${requiredScope}`);
    }

    await this.prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    request.apiKey = {
      companyId: keyRecord.companyId,
      company: keyRecord.company,
      scopes,
      keyId: keyRecord.id,
    };
    request.user = { companyId: keyRecord.companyId, type: 'api_key' };

    return true;
  }
}
