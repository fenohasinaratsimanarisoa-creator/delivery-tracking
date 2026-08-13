import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import Redis from 'ioredis';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.scope && payload.scope !== 'access') {
      throw new UnauthorizedException('Invalid token scope');
    }

    if (payload.iat && this.redis) {
      const revokedAt = await this.redis.get(`revoked:user:${payload.sub}`);
      if (revokedAt) {
        const revokedTimestamp = parseInt(revokedAt, 10);
        if (payload.iat < revokedTimestamp) {
          throw new UnauthorizedException('Token has been revoked');
        }
      }
    }

    if (payload.type === 'platform_admin') {
      const admin = await this.prisma.platformAdmin.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      });

      if (!admin || !admin.isActive) {
        throw new UnauthorizedException('Platform admin not found or inactive');
      }

      return {
        ...admin,
        role: 'super_admin' as const,
        type: 'platform_admin' as const,
      };
    }

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

    return {
      ...user,
      type: 'user' as const,
      impersonatedBy: payload.impersonatedBy,
      sessionId: payload.sessionId,
    };
  }
}
