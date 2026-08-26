import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  Get,
  UnauthorizedException,
  Delete,
  Param,
  BadRequestException,
  Inject,
  Logger,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import * as passport from 'passport';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { OAuthRelayService } from './oauth-relay.service';
import { GoogleAuthStateGuard } from './guards/google-auth-state.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Verify2faDto, Verify2faCodeDto, Disable2faDto } from './dto/two-factor.dto';
import { OAuthBeginDto } from './dto/oauth-begin.dto';
import { OAuthExchangeDto } from './dto/oauth-exchange.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { CsrfGuard, getDevFallbackSecret } from '../../common/guards/csrf.guard';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { SessionsService } from '../sessions/sessions.service';

// La sécurité des cookies (Secure, SameSite) doit refléter le protocole RÉEL
// de déploiement, pas NODE_ENV. Un VPS de prod sans domaine/TLS (ex. Contabo,
// IP nue servie en http://) est un cas de prod légitime — or NODE_ENV=production
// forçait Secure+SameSite=None ici, que des flags que TOUS les navigateurs
// rejettent silencieusement sur une origine http:// (aucune erreur réseau
// visible : le cookie n'est simplement jamais stocké). Résultat en prod HTTP :
// refreshToken ET csrf-token ne survivent jamais → "Missing CSRF token" sur
// toute mutation, session qui ne survit pas à un refresh. APP_URL (URL
// publique canonique de CE déploiement, toujours définie — voir .env.*.example
// et render.yaml) est le bon signal : il reflète le protocole réellement servi,
// contrairement à NODE_ENV qui ne dit rien du transport.
const primaryOrigin =
  process.env.APP_URL || (process.env.CORS_ORIGIN || '').split(',')[0]?.trim() || '';
const isSecure = primaryOrigin.startsWith('https://');
// SameSite=None sans Secure est rejeté par tous les navigateurs modernes — et
// sur une origine http:// sans TLS, 'lax' suffit de toute façon : frontend et
// API sont same-origin (nginx proxy /api en interne, voir nginx.conf.template),
// jamais de vraie requête cross-site à couvrir.
const sameSite = isSecure ? ('none' as const) : ('lax' as const);

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isSecure,
  sameSite,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: isSecure,
  sameSite,
  maxAge: 24 * 60 * 60 * 1000,
  path: '/',
};

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly oauthRelayService: OAuthRelayService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private getRefreshCookieOpts() {
    const domain = this.configService.get<string>('COOKIE_DOMAIN');
    if (domain) {
      return { ...REFRESH_COOKIE_OPTIONS, domain };
    }
    return REFRESH_COOKIE_OPTIONS;
  }

  private getCsrfCookieOpts() {
    const domain = this.configService.get<string>('COOKIE_DOMAIN');
    if (domain) {
      return { ...CSRF_COOKIE_OPTIONS, domain };
    }
    return CSRF_COOKIE_OPTIONS;
  }

  // Public : appelé AVANT toute authentification (register/login) ou par un
  // visiteur anonyme avant /auth/refresh — ne doit jamais exiger de JWT.
  @Public()
  @SkipCsrf()
  @SkipThrottle()
  @Get('csrf-token')
  getCsrfToken(@Res({ passthrough: true }) res: Response) {
    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();
    const { token, hmac } = CsrfGuard.generateToken(secret);
    const opts = this.getCsrfCookieOpts();
    res.cookie('csrf-token', token, opts);
    return { csrfToken: token, csrfHmac: hmac };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(
      dto,
      req.ip || '',
      req.headers?.['user-agent'] || '',
    );
    // Garde-fou COOKIE_DOMAIN (voir commentaire login)
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });
    const opts = this.getRefreshCookieOpts();
    res.cookie('refreshToken', result.refreshToken, opts);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const ip = req.ip || '';
      const userAgent = req.headers?.['user-agent'] || '';
      const result = await this.authService.login(dto, ip, userAgent);
      if (result.requiresTwoFactor) {
        // Étape 1 : aucun cookie de session (refreshToken vide). Le tempToken
        // (usage unique, TTL court) est passé au front pour l'étape 2.
        return {
          accessToken: '',
          user: result.user,
          requiresTwoFactor: true,
          tempToken: result.tempToken,
        };
      }
      // Garde-fou COOKIE_DOMAIN : clear les anciens cookies SANS l'option domain
      // (host-only) avant de poser les nouveaux. Évite les doublons si COOKIE_DOMAIN
      // a été ajouté/retiré entre deux deploys — un cookie de portée différente
      // pourrait coexister et le mauvais serait transmis au serveur.
      res.clearCookie('refreshToken', { path: '/' });
      res.clearCookie('csrf-token', { path: '/' });
      const opts = this.getRefreshCookieOpts();
      res.cookie('refreshToken', result.refreshToken, opts);
      return {
        accessToken: result.accessToken,
        user: result.user,
        requiresTwoFactor: false,
      };
    } catch (err: any) {
      // Pas d'email en clair dans les logs (PII).
      const emailHash = createHash('sha256').update(dto.email).digest('hex').slice(0, 16);
      this.logger.error(`LOGIN FAILED (email sha256:${emailHash}): ${err?.message || err}`);
      throw err;
    }
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  // PAS de @SkipCsrf ici : la rotation hostile du refresh token via formulaire
  // cross-site est précisément ce que CsrfGuard neutralise (cookie+header).
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token not found');
    }
    const result = await this.authService.refresh(
      refreshToken,
      req.ip || '',
      req.headers?.['user-agent'] || '',
    );
    // Garde-fou COOKIE_DOMAIN : clear l'ancien cookie SANS l'option domain (host-only)
    // avant de poser le nouveau. Évite les doublons si COOKIE_DOMAIN a changé.
    res.clearCookie('refreshToken', { path: '/' });
    const opts = this.getRefreshCookieOpts();
    res.cookie('refreshToken', result.refreshToken, opts);
    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser('sessionId') sessionId: string | undefined = undefined,
  ) {
    await this.authService.logout(userId, sessionId);
    // Invalide l'access token de CETTE session (défense en profondeur : sans
    // ça, un token volé restait utilisable jusqu'à son expiration, ~15 min).
    // Les autres sessions de l'utilisateur ne sont pas touchées.
    if (sessionId) await this.markAccessRevoked(userId, sessionId);
    const opts = this.getRefreshCookieOpts();
    res.clearCookie('refreshToken', { ...opts, maxAge: undefined });
    res.clearCookie('csrf-token', { ...this.getCsrfCookieOpts(), maxAge: undefined });
  }

  /**
   * Émet le credential longue durée du worker natif de tracking (Android).
   * Appelé par le JS après login et à chaque refresh réussi — voir
   * AuthService.issueDeviceTrackingToken pour le pourquoi et le périmètre de
   * sécurité (scope 'device_tracking', utilisable UNIQUEMENT sur
   * POST /tracking/positions/native-batch).
   */
  @UseGuards(JwtAuthGuard)
  @Post('device-token')
  @HttpCode(HttpStatus.OK)
  async issueDeviceToken(
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string | undefined = undefined,
  ): Promise<{ deviceToken: string; expiresAt: number }> {
    return this.authService.issueDeviceTrackingToken(userId, sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@CurrentUser('id') userId: string, @Req() req: Request) {
    // Passe par le service : le select n'expose jamais refreshTokenHash (avant,
    // la requête était dupliquée dans le controller avec un select partiel).
    const sessions = await this.sessionsService.findAll(userId);
    const currentSessionId = (req.user as any)?.sessionId;
    return sessions.map((s) => ({ ...s, isCurrent: s.id === currentSessionId }));
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Param('id') sessionId: string,
    @Req() req: any,
  ) {
    // Purge le refreshTokenHash + audit (voir SessionsService.revokeSession)
    await this.sessionsService.revokeSession(
      userId,
      sessionId,
      companyId,
      req.ip,
      req.headers?.['user-agent'],
    );
    // Révocation SCOPÉE à cette session : les access tokens des autres appareils
    // restent valides (avant : clé user-scoped qui déconnectait tout l'utilisateur).
    await this.markAccessRevoked(userId, sessionId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllSessions(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Req() req: any,
  ) {
    const currentSessionId = (req.user as any)?.sessionId;
    const revoked = await this.sessionsService.revokeAllSessions(
      userId,
      companyId,
      currentSessionId,
      req.ip,
      req.headers?.['user-agent'],
    );
    // Révocation SCOPÉE par session ciblée : les access tokens des sessions
    // supprimées meurent, celui de la session courante (exclue) survit. Avant :
    // (req as any).sessionId était undefined → la session courante était aussi
    // supprimée, et la clé user-scoped coupait même les sessions exclues.
    if (Array.isArray(revoked.ids)) {
      for (const id of revoked.ids) {
        await this.markAccessRevoked(userId, id);
      }
    }
  }

  /**
   * Invalide les access tokens encore vivants d'UNE session ou de TOUTES les
   * sessions. Les clés sont lues par JwtStrategy (revoked:session:<id> /
   * revoked:user:<id>), qui refuse les tokens émis AVANT la révocation
   * (payload.iat < revokedAt). TTL = durée de vie restante de l'access token —
   * au-delà, le token est de toute façon expiré.
   *
   * On stocke now + 1 : payload.iat est en SECONDES (granularité 1 s) — si
   * login, révocation et requête suivante arrivent dans la MÊME seconde, un
   * iat == now rendrait « iat < revokedAt » faux et laisserait passer un token
   * pourtant émis avant/au moment de la révocation. now+1 garantit qu'aucun
   * token existant au moment de la révocation ne survit (un token émis après,
   * iat >= now+1, reste valide).
   */
  private async markAccessRevoked(userId: string, sessionId?: string) {
    if (!this.redis) return;
    const cutoff = Math.floor(Date.now() / 1000) + 1;
    const ttl = this.getAccessTokenExpirySeconds();
    if (sessionId) {
      await this.redis.set(`revoked:session:${sessionId}`, String(cutoff), 'EX', ttl);
    } else {
      await this.redis.set(`revoked:user:${userId}`, String(cutoff), 'EX', ttl);
    }
  }

  private getAccessTokenExpirySeconds(): number {
    const raw = this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m');
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 900;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multiplier[unit] || 60);
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return {
      message: 'If an account exists with this email, you will receive a reset link.',
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Your password has been reset successfully.' };
  }

  @UseGuards(JwtAuthGuard, BlockImpersonationGuard)
  @Get('2fa/generate')
  async generate2fa(@CurrentUser('id') userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.totpEnabled) {
      throw new BadRequestException('2FA is already enabled. Disable it first to regenerate.');
    }
    const result = await this.totpService.generateSecret(user.email);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: result.secret },
    });
    return { secret: result.secret, otpauthUrl: result.otpauthUrl, qrCode: result.qrCode };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2fa(@CurrentUser('id') userId: string, @Body() dto: Verify2faCodeDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new BadRequestException('2FA not set up. Generate a secret first.');
    }
    const isValid = this.totpService.verifyToken(user.totpSecret, dto.token);
    if (!isValid) {
      throw new BadRequestException('Invalid 2FA token');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: true },
    });
    return { message: '2FA enabled successfully' };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtAuthGuard, BlockImpersonationGuard)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  async disable2fa(@CurrentUser('id') userId: string, @Body() dto: Disable2faDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.totpEnabled) {
      throw new BadRequestException('2FA is not enabled');
    }
    const isValid = this.totpService.verifyToken(user.totpSecret!, dto.token);
    if (!isValid) {
      throw new BadRequestException('Invalid 2FA token');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabled: false, totpSecret: null },
    });
    return { message: '2FA disabled successfully' };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @SkipCsrf()
  @Post('2fa/authenticate')
  @HttpCode(HttpStatus.OK)
  async authenticate2fa(
    @Body() dto: Verify2faDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verify2faToken(
      dto,
      req.ip || '',
      req.headers?.['user-agent'] || '',
    );
    // Garde-fou COOKIE_DOMAIN (voir commentaire login)
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });
    res.cookie('refreshToken', result.refreshToken, this.getRefreshCookieOpts());
    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();
    const { token: csrfTok } = CsrfGuard.generateToken(secret);
    res.cookie('csrf-token', csrfTok, this.getCsrfCookieOpts());
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('google/status')
  googleStatus() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    return { configured: !!(clientId && clientId !== '...' && clientId !== 'unconfigured') };
  }

  /**
   * Démarre le flux OAuth natif : émet un nonce (relayId) lié au codeChallenge
   * PKCE de l'app. Le relayId fera l'aller-retour via le paramètre `state` de
   * Google et sera vérifié dans appUrlOpen puis au callback.
   */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('oauth/begin')
  @HttpCode(HttpStatus.OK)
  async oauthBegin(@Body() dto: OAuthBeginDto) {
    const relayId = await this.oauthRelayService.begin(dto.codeChallenge);
    return { relayId };
  }

  /**
   * Échange un code à usage unique (TTL 60 s) contre une session. Le JWT
   * d'accès n'existe que dans le corps de la réponse — jamais dans une URL.
   * La vérification PKCE garantit que seul le possesseur du verifier (l'app
   * légitime, qui ne l'a jamais exposé dans un deep link) peut échanger.
   */
  @Public()
  @SkipCsrf()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  async oauthExchange(
    @Body() dto: OAuthExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.oauthRelayService.verifyAndConsumeCode(dto.code, dto.verifier);
    if (!result) {
      throw new UnauthorizedException('Invalid or expired exchange code');
    }
    const session = await this.authService.createSessionForUser(
      result.userId,
      req.ip || '',
      req.headers?.['user-agent'] || '',
    );
    // Garde-fou COOKIE_DOMAIN (voir commentaire login)
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });
    res.cookie('refreshToken', session.refreshToken, this.getRefreshCookieOpts());
    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();
    const { token: csrfTok } = CsrfGuard.generateToken(secret);
    res.cookie('csrf-token', csrfTok, this.getCsrfCookieOpts());
    this.logger.log(`OAuth native exchange success for user ${result.userId}`);
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @UseGuards(GoogleAuthStateGuard)
  @Get('google')
  googleAuth() {
    // Guard handles redirect to Google
  }

  @Public()
  @SkipThrottle()
  @Get('google/callback')
  googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('APP_URL') || 'http://localhost:5173';
    const refreshOpts = this.getRefreshCookieOpts();
    const csrfOpts = this.getCsrfCookieOpts();

    const authenticate = passport.authenticate(
      'google',
      { session: false },
      async (err: any, user: any, info: any) => {
        if (err || !user) {
          let error = 'google_auth_failed';
          if (!user && info?.message === 'access_denied') error = 'access_denied';
          else if (err?.message === 'Email not verified') error = 'email_not_verified';
          else if (err?.message === 'Account deactivated') error = 'account_deactivated';
          else if (err?.message === 'Domain not found') error = 'account_not_found';
          this.logger.error(
            `Google OAuth callback failed: err=${err?.message || 'none'}, info=${info?.message || 'none'}, user=${!!user}`,
          );
          if (err?.stack) this.logger.error(`Google OAuth stack: ${err.stack}`);
          return res.redirect(`${frontendUrl}/auth/callback?error=${error}`);
        }

        if (!user.accessToken) {
          this.logger.error(`Google OAuth: no accessToken in response for user ${user.user?.id}`);
          return res.redirect(`${frontendUrl}/auth/callback?error=google_auth_failed`);
        }

        this.logger.log(`Google OAuth success for user ${user.user?.id}`);

        const relayId = req.query && typeof req.query.state === 'string' ? req.query.state : null;

        const tokenParam = encodeURIComponent(user.accessToken);
        // Cookie posé UNIQUEMENT si le refresh token existe réellement : un
        // cookie vide provoquerait des erreurs « Refresh token not found »
        // confuses côté client.
        // Garde-fou COOKIE_DOMAIN (voir commentaire login)
        res.clearCookie('refreshToken', { path: '/' });
        res.clearCookie('csrf-token', { path: '/' });
        if (user.refreshToken) {
          res.cookie('refreshToken', user.refreshToken, refreshOpts);
        }

        const configuredSecret = this.configService.get<string>('CSRF_SECRET');
        const secret = configuredSecret || getDevFallbackSecret();
        const { token: csrfTok } = CsrfGuard.generateToken(secret);
        res.cookie('csrf-token', csrfTok, csrfOpts);

        // Flux natif : `state` (nonce) présent et valide → on ne met JAMAIS le
        // JWT de session dans l'URL. On émet un code à usage unique (TTL 60 s)
        // lié au codeChallenge PKCE, échangé ensuite par POST /auth/exchange.
        if (relayId && (await this.oauthRelayService.isRelayValid(relayId))) {
          const code = await this.oauthRelayService.issueCode(relayId, user.user?.id);
          if (!code) {
            this.logger.error(`Google OAuth native: relay expired for ${user.user?.id}`);
            return res.redirect(`${frontendUrl}/auth/callback?error=google_auth_failed`);
          }
          this.logger.log(`Google OAuth native: single-use code issued (state bound)`);
          return res.redirect(
            `${frontendUrl}/auth/callback#code=${code}&state=${encodeURIComponent(relayId)}`,
          );
        }

        return res.redirect(`${frontendUrl}/auth/callback#accessToken=${tokenParam}`);
      },
    );

    authenticate(req, res, (nextErr?: any) => {
      if (nextErr) {
        this.logger.error('Google callback passport next() error', nextErr?.message || nextErr);
        res.redirect(`${frontendUrl}/auth/callback?error=google_auth_failed`);
      }
    });
  }
}
