import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
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
  private readonly accessExpiration: string;
  private readonly refreshExpiration: string;
  private readonly tempTokenExpiration = '5m';

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
    private totpService: TotpService,
  ) {
    this.accessExpiration = this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m');
    this.refreshExpiration = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
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

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.userSession.create({
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
          secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
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

    return this.generateTokens(user.id, user.email, user.role, user.companyId);
  }

  async verify2faToken(dto: Verify2faDto): Promise<TokenResponse> {
    let payload: { sub: string; scope: string };
    try {
      payload = this.jwtService.verify<{ sub: string; scope: string }>(dto.tempToken, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
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
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            email: true,
            role: true,
            companyId: true,
            firstName: true,
            lastName: true,
            isActive: true,
            refreshTokenHash: true,
            totpEnabled: true,
          },
        });

        if (!user || !user.isActive || !user.refreshTokenHash) {
          throw new UnauthorizedException('Invalid refresh token');
        }

        const isTokenValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
        if (!isTokenValid) {
          await tx.userSession.deleteMany({ where: { userId: user.id } });
          await tx.user.update({
            where: { id: user.id },
            data: { refreshTokenHash: null },
          });
          throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
        }

        return user;
      },
      { timeout: 15000 },
    );

    return this.generateTokens(result.id, result.email, result.role, result.companyId);
  }

  async logout(userId: string): Promise<void> {
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

    const rawToken = crypto.randomBytes(48).toString('hex');
    const hashedToken = await bcrypt.hash(rawToken, 10);
    const expiry = new Date(Date.now() + 30 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetTokenHash: hashedToken,
        resetTokenExpiry: expiry,
      },
    });

    this.emailService.sendPasswordReset(email, rawToken).catch((err) => {
      this.logger.error('Password reset email failed', err);
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: {
        resetTokenHash: { not: null },
        resetTokenExpiry: { gte: new Date() },
      },
    });

    let matchedUser: (typeof users)[number] | null = null;
    for (const u of users) {
      if (u.resetTokenHash && (await bcrypt.compare(token, u.resetTokenHash))) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      throw new BadRequestException('The reset link is invalid or has expired.');
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.user.update({
      where: { id: matchedUser.id },
      data: {
        passwordHash,
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

    const domain = email.split('@')[1];
    let company = await this.prisma.company.findFirst({
      where: { email: { not: null, endsWith: '@' + domain } },
    });

    if (!company) {
      company = await this.prisma.company.create({
        data: { name: `${firstName} ${lastName}`, email },
      });
    }

    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
    user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'admin',
        companyId: company.id,
        googleId,
      },
    });

    return this.generateTokens(user.id, user.email, user.role, user.companyId);
  }

  private async generateTokens(
    userId: string,
    email: string,
    role: string,
    companyId: string,
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

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      expiresIn: this.accessExpiration,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      expiresIn: this.refreshExpiration,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash },
    });

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
