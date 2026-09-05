import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';
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

  // Le cookie CSRF est un double-submit anonyme (même paire token/hmac valide
  // pour n'importe qui — c'est le principe du pattern, pas une faille en soi).
  // Sa sécurité repose sur le fait que SEUL le domaine cible peut poser ce
  // cookie. `COOKIE_DOMAIN` scope le cookie au domaine PARENT (ex: .example.com) :
  // combiné à SameSite=None (obligatoire dès que APP_URL est en https), n'importe
  // quel sous-domaine capable d'écrire un cookie neutralise la protection pour
  // tout le domaine. Prod actuelle (Contabo, hôte unique) ne définit pas
  // COOKIE_DOMAIN — ce garde-fou ne bloque donc rien aujourd'hui, seulement un
  // futur déploiement multi-sous-domaines mal configuré.
  const cookieDomain = configService.get<string>('COOKIE_DOMAIN');
  const appUrl = configService.get<string>('APP_URL', '');
  const isHttps = appUrl.startsWith('https://');
  if (cookieDomain && isHttps && nodeEnv === 'production') {
    throw new Error(
      'COOKIE_DOMAIN is set with an https APP_URL (SameSite=None) — this lets any ' +
        'subdomain of COOKIE_DOMAIN forge the CSRF cookie and defeat the protection ' +
        'for the whole domain family. Remove COOKIE_DOMAIN unless every subdomain is ' +
        'fully trusted, or scope it to a domain with no untrusted subdomains.',
    );
  }
}

/** Comparaison constant-time (même pattern que oauth-relay.service.safeEqual). */
function timingSafeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private configService: ConfigService,
    private reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skipCsrf) return true;

    const request = context.switchToHttp().getRequest();

    if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
      return true;
    }

    const cookieToken = request.cookies?.['csrf-token'];
    const headerToken = request.headers?.['x-csrf-token'];

    if (!cookieToken || !headerToken) {
      throw new ForbiddenException('Missing CSRF token');
    }

    if (!timingSafeEquals(cookieToken, headerToken)) {
      throw new ForbiddenException('Invalid CSRF token');
    }

    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();

    const expectedHmac = crypto.createHmac('sha256', secret).update(cookieToken).digest('hex');

    const providedHmac = request.headers?.['x-csrf-hmac'];
    if (!providedHmac || !timingSafeEquals(providedHmac, expectedHmac)) {
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
