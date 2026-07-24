import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
  ) {}

  async verify(client: Socket): Promise<WsAuthenticatedUser> {
    const token = this.extractToken(client);
    if (!token) {
      throw new WsAuthError('Missing or invalid token', 'TOKEN_MISSING');
    }

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });

      if (!payload.sub || !payload.companyId) {
        throw new WsAuthError('Invalid token payload', 'INVALID_PAYLOAD');
      }

      const user: WsAuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        companyId: payload.companyId,
        firstName: payload.firstName || '',
        lastName: payload.lastName || '',
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
