import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

let devFallbackSecret: string | null = null;

export function getDevFallbackSecret(): string {
  if (!devFallbackSecret) {
    devFallbackSecret = crypto.randomBytes(32).toString('hex');
    Logger.warn(
      'CSRF_SECRET not set — using random in-memory secret for development. ' +
        'Set CSRF_SECRET in your .env for a stable secret across restarts.',
      'CsrfGuard',
    );
  }
  return devFallbackSecret;
}

export function validateCsrfSecret(configService: ConfigService): void {
  const secret = configService.get<string>('CSRF_SECRET');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  if (!secret && nodeEnv === 'production') {
    throw new Error(
      'CSRF_SECRET is required in production. Generate one with: openssl rand -hex 32',
    );
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return true;
    }

    const cookieToken = request.cookies?.['csrf-token'];
    const headerToken = request.headers?.['x-csrf-token'];

    if (!cookieToken || !headerToken) {
      throw new ForbiddenException('Missing CSRF token');
    }

    if (cookieToken !== headerToken) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();

    const expectedHmac = crypto.createHmac('sha256', secret).update(cookieToken).digest('hex');

    const providedHmac = request.headers?.['x-csrf-hmac'];
    if (!providedHmac || providedHmac !== expectedHmac) {
      throw new ForbiddenException('Invalid CSRF token signature');
    }

    return true;
  }

  static generateToken(secret: string): { token: string; hmac: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const hmac = crypto.createHmac('sha256', secret).update(token).digest('hex');
    return { token, hmac };
  }
}
