import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TotpService } from './totp.service';
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
  private dummyHash: string | null = null;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private totpService: TotpService,
  ) {
    this.accessExpiration = this.configService.get<string>(
      'JWT_ACCESS_EXPIRATION',
      '15m',
    ) as jwt.SignOptions['expiresIn'];
    this.refreshExpiration = this.configService.get<string>(
      'JWT_REFRESH_EXPIRATION',
      '7d',
    ) as jwt.SignOptions['expiresIn'];
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
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });

    await bcrypt.compare(dto.password, user?.passwordHash || this.getDummyHash());

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const session = await this.prisma.userSession.create({
      data: {
        userId: user.id,
        device: userAgent,
        ip,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

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

    return this.generateTokens(user.id, user.email, user.role, user.companyId, session.id);
  }

  async verify2faToken(dto: Verify2faDto): Promise<TokenResponse> {
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

    return this.generateTokens(user.id, user.email, user.role, user.companyId);
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string): Promise<TokenResponse> {
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
          // se connecter légitimement). Une IP très différente de celle de la
          // session est signalée pour investigation (replay suspect).
          if (session.ip && ip && session.ip !== ip) {
            this.logger.warn(
              `[auth] refresh reuse suspect: session=${sessionId} user=${session.user.id} ` +
                `ip=${ip} sessionIp=${session.ip}`,
            );
          }
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
  }

  async validateGoogleUser(profile: {
    googleId: string;
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<TokenResponse> {
    const { googleId, firstName, lastName } = profile;
    const email = profile.email.toLowerCase().trim();

    let user = await this.prisma.user.findUnique({ where: { googleId } });
    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account deactivated');
      }
      return this.generateTokens(user.id, user.email, user.role, user.companyId);
    }

    user = await this.prisma.user.findUnique({ where: { email } });
    if (user) {
      if (!user.isActive) {
        throw new UnauthorizedException('Account deactivated');
      }
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
      select: { id: true, email: true, role: true, companyId: true, isActive: true },
    });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account deactivated');
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
            last_activity = now()
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
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
