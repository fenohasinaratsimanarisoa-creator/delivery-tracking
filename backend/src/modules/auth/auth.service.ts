import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TotpService } from './totp.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Verify2faDto } from './dto/two-factor.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { TokenResponse } from './interfaces/token-response.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly accessExpiration: jwt.SignOptions['expiresIn'];
  private readonly refreshExpiration: jwt.SignOptions['expiresIn'];
  private readonly tempTokenExpiration: jwt.SignOptions['expiresIn'] = '5m';
  // Durée de vie des UserSession : alignée sur JWT_REFRESH_EXPIRATION (avant :
  // 7 jours codés en dur, incohérents si la config changeait).
  private readonly refreshExpirationSeconds: number;
  // Verrouillage par compte (défense brute-force au-delà du throttle par IP) :
  // N échecs de mot de passe dans une fenêtre → compte bloqué pour la fenêtre.
  // Uniquement actif si Redis est disponible ; les échecs ne doivent JAMAIS
  // lever d'erreur Redis (le login ne doit pas tomber à cause du lockout).
  private readonly loginFailWindowSeconds = 15 * 60;
  private readonly loginFailMaxAttempts = 15;
  private dummyHash: string | null = null;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private totpService: TotpService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    this.accessExpiration = this.configService.get<string>(
      'JWT_ACCESS_EXPIRATION',
      '15m',
    ) as jwt.SignOptions['expiresIn'];
    this.refreshExpiration = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    ) as jwt.SignOptions['expiresIn'];
    this.refreshExpirationSeconds = this.parseExpirationSeconds(this.refreshExpiration);
  }

  private parseExpirationSeconds(expiration: string | number | undefined): number {
    if (typeof expiration === 'number') return expiration;
    if (typeof expiration !== 'string') return 7 * 24 * 60 * 60;
    const match = /^(\d+)([smhd])$/.exec(expiration);
    if (!match) return 7 * 24 * 60 * 60;
    const value = parseInt(match[1], 10);
    const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    return value * (multiplier[match[2]] || 60);
  }

  private loginFailKey(email: string): string {
    // Email haché (PII) : la clé Redis ne contient jamais l'email en clair.
    const hash = crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
    return `login_fail:${hash.slice(0, 32)}`;
  }

  /**
   * Refuse le login si le compte est déjà verrouillé (échecs répétés).
   * Ne doit jamais échouer sur une erreur Redis : sans Redis, pas de lockout.
   */
  private async checkLoginLockout(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const count = await this.redis.get(this.loginFailKey(email));
      if (count && parseInt(count, 10) >= this.loginFailMaxAttempts) {
        throw new UnauthorizedException(
          'Too many failed login attempts. Please try again later.',
        );
      }
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Erreur Redis → on laisse passer (défense en profondeur, jamais bloquant).
    }
  }

  private async recordLoginFailure(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      const key = this.loginFailKey(email);
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.loginFailWindowSeconds);
      }
    } catch {
      // Erreur Redis → on ne bloque jamais le login pour ça.
    }
  }

  private async clearLoginFailures(email: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.del(this.loginFailKey(email));
    } catch {
      // ignore
    }
  }

  private getDummyHash(): string {
    if (!this.dummyHash) {
      this.dummyHash = bcrypt.hashSync('dummy-timing-attack-mitigation', 10);
    }
    return this.dummyHash;
  }

  async register(dto: RegisterDto): Promise<TokenResponse> {
    dto.email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const result = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: { name: dto.companyName },
      });

      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          role: 'admin',
          companyId: company.id,
        },
      });

      return { user, company };
    });

    this.emailService.sendWelcome(dto.email, dto.firstName).catch((err) => {
      this.logger.error('Welcome email failed', err);
    });

    return this.generateTokens(
      result.user.id,
      result.user.email,
      result.user.role,
      result.user.companyId,
    );
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<TokenResponse> {
    dto.email = dto.email.toLowerCase().trim();

    // Verrouillage par compte : vérifié AVANT le travail bcrypt (un compte
    // verrouillé ne consomme même pas de CPU) et sans révéler l'existence du
    // compte (le lockout est clé par email, y compris pour les emails inconnus).
    await this.checkLoginLockout(dto.email);

    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    // Un seul bcrypt.compare : impossible d'énumérer les comptes par le temps de
    // réponse (côté temps de vérification, user inexistant == user invalide).
    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user?.passwordHash || this.getDummyHash(),
    );
    if (!user || !user.isActive || !isPasswordValid) {
      // Comptabilise l'échec pour le lockout par compte (jamais bloquant).
      await this.recordLoginFailure(dto.email);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Mot de passe valide → on efface l'historique d'échecs de ce compte.
    await this.clearLoginFailures(dto.email);

    if (user.totpEnabled) {
      const tempToken = this.jwtService.sign(
        { sub: user.id, scope: '2fa_pending' },
        {
          secret: this.configService.get<string>(
            'JWT_2FA_TEMP_SECRET',
            this.configService.get<string>('JWT_ACCESS_SECRET')!,
          ),
          expiresIn: this.tempTokenExpiration,
        },
      );
      return {
        accessToken: '',
        refreshToken: '',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          companyId: user.companyId,
        },
        requiresTwoFactor: true,
        tempToken,
      };
    }

    // La UserSession n'est créée qu'ici (jamais à l'étape 1 du 2FA) : en 2FA,
    // c'est verify2faToken qui matérialise la session, avec le même contexte
    // ip/device. Sinon on laisserait une session orpheline à chaque étape 1.
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        device: userAgent,
        ip,
        expiresAt: new Date(Date.now() + this.refreshExpirationSeconds * 1000),
      },
    });

    return this.generateTokens(user.id, user.email, user.role, user.companyId, session.id);
  }

  async verify2faToken(dto: Verify2faDto, ip?: string, userAgent?: string): Promise<TokenResponse> {
    let payload: { sub: string; scope: string };
    try {
      payload = this.jwtService.verify<{ sub: string; scope: string }>(dto.tempToken, {
        secret: this.configService.get<string>(
          'JWT_2FA_TEMP_SECRET',
          this.configService.get<string>('JWT_ACCESS_SECRET')!,
        ),
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired temporary token');
    }

    if (payload.scope !== '2fa_pending') {
      throw new UnauthorizedException('Invalid token scope');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
      throw new UnauthorizedException('User not found or 2FA not enabled');
    }

    const isValid = this.totpService.verifyToken(user.totpSecret, dto.token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    // Étape 2 du 2FA : c'est ici que la session est matérialisée (l'étape 1 n'en
    // crée pas), avec le contexte ip/device de la requête.
    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        device: userAgent,
        ip,
        expiresAt: new Date(Date.now() + this.refreshExpirationSeconds * 1000),
      },
    });

    return this.generateTokens(user.id, user.email, user.role, user.companyId, session.id);
  }

  async refresh(refreshToken: string, ip?: string, _userAgent?: string): Promise<TokenResponse> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Le refresh token est rattaché à UNE session UserSession précise (sessionId
    // dans le payload JWT), jamais au champ legacy User.refreshTokenHash. Un JWT
    // émis avant la migration session_scoped_refresh_token ne porte pas de
    // sessionId : échec PROPRE (401, pas de crash 500) — l'utilisateur se
    // reconnecte, son ancien hash User a été invalidé par la migration.
    const sessionId = payload.sessionId;
    if (!sessionId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const session = await tx.userSession.findUnique({
          where: { id: sessionId },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                role: true,
                companyId: true,
                firstName: true,
                lastName: true,
                isActive: true,
                totpEnabled: true,
              },
            },
          },
        });

        if (!session || !session.user || !session.user.isActive) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        if (!session.refreshTokenHash) {
          throw new UnauthorizedException('Invalid refresh token');
        }
        if (session.expiresAt.getTime() < Date.now()) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const matchesCurrent = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        const matchesPrevious = session.previousRefreshTokenHash
          ? await bcrypt.compare(refreshToken, session.previousRefreshTokenHash)
          : false;

        if (!matchesCurrent && !matchesPrevious) {
          // Reuse détecté : le token ne correspond à AUCUNE génération de la
          // session (ni courante, ni la précédente). C'est un rejeu après au
          // moins deux rotations, donc un vrai replay/vol — pas la course
          // multi-onglets (celle-ci est couverte par previousRefreshTokenHash).
          // On ne révoque QUE CETTE session (avant : deleteMany sur userId, qui
          // révoquait TOUTES les sessions — y compris un appareil qui venait de
          // se connecter légitimement). Un rejeu est TOUJOURS signalé, même à
          // IP identique (un voleur derrière le même NAT/proxy passerait sinon
          // inaperçu) ; la comparaison d'IP est conservée pour le contexte.
          this.logger.warn(
            `[auth] refresh token REUSE detected (possible theft): session=${sessionId} ` +
              `user=${session.user.id} ip=${ip || 'unknown'} sessionIp=${session.ip || 'unknown'}`,
          );
          await tx.userSession.update({
            where: { id: sessionId },
            data: { refreshTokenHash: null, previousRefreshTokenHash: null },
          });
          await tx.userSession.delete({ where: { id: sessionId } });
          throw new UnauthorizedException('Refresh token reuse detected — session revoked');
        }

        if (!matchesCurrent && matchesPrevious) {
          // Course multi-onglets légitime : ce token est l'ancienne génération,
          // écrasée par un refresh concurrent (même cookie partagé). On accepte
          // et la rotation ATOMIQUE de generateTokens le remettra en position
          // courante → les onglets convergent au lieu d'être déconnectés.
          this.logger.warn(
            `[auth] refresh race window (concurrent tabs): session=${sessionId} user=${session.user.id}`,
          );
        }

        return session.user;
      },
      { timeout: 15000 },
    );

    return this.generateTokens(result.id, result.email, result.role, result.companyId, sessionId);
  }

  async logout(userId: string, sessionId?: string): Promise<void> {
    if (sessionId) {
      // Déconnexion de CETTE session : purge son refresh token (le hash vit sur la
      // ligne UserSession) puis supprime la ligne. Les autres appareils connectés
      // gardent leur propre session/refresh token intacts.
      await this.prisma.userSession.updateMany({
        where: { id: sessionId, userId },
        data: { refreshTokenHash: null },
      });
      await this.prisma.userSession.deleteMany({ where: { id: sessionId, userId } });
      return;
    }
    // Repli legacy (access token émis avant la propagation du sessionId) :
    // invalide le hash historique sur User — plus utilisé par la nouvelle logique.
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    email = email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Consomme le même budget temps qu'un utilisateur existant, afin qu'on ne
      // puisse pas énumérer les comptes via la latence.
      await bcrypt.compare('dummy', this.getDummyHash());
      return;
    }

    const resetTokenId = crypto.randomUUID();
    const rawSecret = crypto.randomBytes(48).toString('hex');
    const hashedSecret = await bcrypt.hash(rawSecret, 10);
    const expiry = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenId,
        resetTokenHash: hashedSecret,
        resetTokenExpiry: expiry,
      },
    });

    const combinedToken = `${resetTokenId}:${rawSecret}`;
    this.emailService.sendPasswordReset(email, combinedToken).catch((err) => {
      this.logger.error('Password reset email failed', err);
    });
  }

  async resetPassword(combinedToken: string, newPassword: string): Promise<void> {
    const colonIndex = combinedToken.indexOf(':');
    if (colonIndex === -1) {
      throw new BadRequestException('The reset link is invalid or has expired.');
    }

    const resetTokenId = combinedToken.slice(0, colonIndex);
    const rawSecret = combinedToken.slice(colonIndex + 1);

    const user = await this.prisma.user.findUnique({
      where: { resetTokenId },
    });

    if (!user || !user.resetTokenHash || !user.resetTokenExpiry) {
      throw new BadRequestException('The reset link is invalid or has expired.');
    }

    if (user.resetTokenExpiry < new Date()) {
      throw new BadRequestException('The reset link is invalid or has expired.');
    }

    const isSecretValid = await bcrypt.compare(rawSecret, user.resetTokenHash);
    if (!isSecretValid) {
      throw new BadRequestException('The reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetTokenId: null,
        resetTokenHash: null,
        resetTokenExpiry: null,
        refreshTokenHash: null,
      },
    });

    // Réinitialisation du mot de passe == révocation de TOUTES les sessions :
    // purge les refreshTokenHash des UserSession (le hash vit sur Session depuis
    // le modèle session-scoped) puis supprime les lignes. Sinon un appareil volé
    // garderait un refresh token valide malgré le changement de mot de passe.
    await this.prisma.userSession.updateMany({
      where: { userId: user.id },
      data: { refreshTokenHash: null },
    });
    await this.prisma.userSession.deleteMany({ where: { userId: user.id } });
  }

  async validateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<TokenResponse> {
    const { googleId, firstName, lastName } = profile;
    const email = profile.email.toLowerCase().trim();

    // Un compte avec 2FA activée ne peut PAS passer par Google (aucun moyen de
    // présenter le code TOTP dans ce flux) : on refuse plutôt que de
    // contourner la 2FA en authentifiant l'utilisateur sans son deuxième facteur.
    const refuseTotp = (u: { id: string; totpEnabled: boolean }) => {
      if (u.totpEnabled) {
        throw new UnauthorizedException('Two-factor authentication required');
      }
    };

    let user = await this.prisma.user.findUnique({ where: { googleId } });
    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account deactivated');
      }
      refuseTotp(user);
      return this.generateTokens(user.id, user.email, user.role, user.companyId);
    }

    user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account deactivated');
      }
      refuseTotp(user);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId },
      });
      return this.generateTokens(user.id, user.email, user.role, user.companyId);
    }

    const pendingInvitation = await this.prisma.invitation.findFirst({
      where: { email, status: 'pending', expiresAt: { gte: new Date() } },
      include: { company: true },
    });

    let companyId: string;
    let role = 'admin' as string;

    if (pendingInvitation) {
      companyId = pendingInvitation.companyId;
      role = pendingInvitation.role;
    } else {
      const company = await this.prisma.company.create({
        data: { name: `${firstName} ${lastName}`, email },
      });
      companyId = company.id;
    }

    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: role as any,
        companyId,
        googleId,
      },
    });

    if (pendingInvitation) {
      await this.prisma.invitation.update({
        where: { id: pendingInvitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
    }

    return this.generateTokens(user.id, user.email, user.role, user.companyId);
  }

  /**
   * Émet une session (access + refresh) pour un utilisateur identifié par un
   * code d'échange OAuth natif validé (voir POST /auth/exchange). Le refresh
   * token est stocké haché (rotation) comme dans login/refresh.
   */
  async createSessionForUser(userId: string): Promise<TokenResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        companyId: true,
        isActive: true,
        totpEnabled: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account deactivated');
    }
    if (user.totpEnabled) {
      throw new UnauthorizedException('Two-factor authentication required');
    }
    return this.generateTokens(user.id, user.email, user.role, user.companyId);
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    companyId: string,
    sessionId?: string,
  ): Promise<TokenResponse> {
    const userRecord = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    if (!userRecord) {
      throw new UnauthorizedException('User not found');
    }
    const payload: JwtPayload = {
      sub: userId,
      email,
      role: role as JwtPayload['role'],
      companyId,
      firstName: userRecord?.firstName || '',
      lastName: userRecord?.lastName || '',
    };
    // Le refresh token embarque l'identifiant de la UserSession de CETTE connexion :
    // au refresh, on retrouve la session SANS ambiguïté (et non plus via userId seul,
    // qui confondait tous les appareils). Exposé aussi sur l'access token pour que
    // JwtStrategy le propage vers request.user (ex. marquage "session courante").
    if (sessionId) payload.sessionId = sessionId;

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      expiresIn: this.accessExpiration,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      expiresIn: this.refreshExpiration,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    if (sessionId) {
      // Rotation ATOMIQUE du refresh token sur CETTE session : le hash courant
      // devient previous (historique un niveau), le nouveau hash prend sa place.
      // Les autres sessions de l'utilisateur gardent leur hash intacts. Le champ
      // legacy User.refreshTokenHash n'est plus écrit ni lu. En concurrence
      // (multi-onglets), l'UPDATE verrouille la ligne : le perdant du dernier
      // gagnant reste toujours accessible via previous_refresh_token_hash et sa
      // prochaine rotation le ré-accepte (voir refresh()).
      const rotated = await this.prisma.$executeRaw`
        UPDATE user_sessions
        SET previous_refresh_token_hash = refresh_token_hash,
            refresh_token_hash = ${refreshTokenHash},
            last_activity = now(),
            expires_at = GREATEST(expires_at, now() + make_interval(secs => ${this.refreshExpirationSeconds}))
        WHERE id = ${sessionId}::uuid AND user_id = ${userId}::uuid
      `;
      if (rotated === 0) {
        // Session supprimée entre la validation (refresh) et la rotation
        // (révocation concurrente) : ne jamais émettre de tokens pour une
        // session morte, on révoque implicitement en refusant.
        throw new UnauthorizedException('Invalid refresh token');
      }
    } else {
      // Appelant sans session existante (register / OAuth / création de session) :
      // on matérialise la UserSession ici pour que le refresh token soit TOUJOURS
      // rattaché à une ligne durable, jamais au champ legacy.
      await this.prisma.userSession.create({
        data: {
          userId,
          refreshTokenHash,
          expiresAt: new Date(Date.now() + this.refreshExpirationSeconds * 1000),
        },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        companyId: true,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: user!,
    };
  }
}
