import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  async verify(client: Socket): Promise<WsAuthenticatedUser> {
    const token = this.extractToken(client);
    if (!token) {
      throw new WsAuthError('Missing or invalid token', 'TOKEN_MISSING');
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });

      if (!payload.sub || !payload.companyId) {
        throw new WsAuthError('Invalid token payload', 'INVALID_PAYLOAD');
      }

      const dbUser = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, role: true, companyId: true, firstName: true, lastName: true, isActive: true, company: { select: { deletedAt: true } } },
      });

      if (!dbUser || !dbUser.isActive) {
        throw new WsAuthError('User not found or inactive', 'TOKEN_INVALID');
      }

      if (dbUser.company?.deletedAt) {
        throw new WsAuthError('Company has been deleted', 'TOKEN_INVALID');
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
      throw new WsAuthError('Invalid or expired token', 'TOKEN_INVALID');
    }
  }

  private extractToken(client: Socket): string | undefined {
    const auth = client.handshake.auth?.token || client.handshake.headers?.authorization;
    if (!auth) return undefined;
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    return auth;
  }
}
