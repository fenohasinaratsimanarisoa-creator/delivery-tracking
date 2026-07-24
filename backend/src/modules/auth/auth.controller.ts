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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response, Request } from 'express';
import * as passport from 'passport';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Enable2faDto, Verify2faDto, Disable2faDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CsrfGuard, getDevFallbackSecret } from '../../common/guards/csrf.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

const isProduction = process.env.NODE_ENV === 'production';
const isSecure = isProduction || (process.env.CORS_ORIGIN || '').startsWith('https');
const sameSite = isProduction ? ('none' as const) : ('lax' as const);

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
  constructor(
    private readonly authService: AuthService,
    private readonly totpService: TotpService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @SkipThrottle()
  @Get('csrf-token')
  getCsrfToken(@Res({ passthrough: true }) res: Response) {
    const configuredSecret = this.configService.get<string>('CSRF_SECRET');
    const secret = configuredSecret || getDevFallbackSecret();
    const { token, hmac } = CsrfGuard.generateToken(secret);
    res.cookie('csrf-token', token, CSRF_COOKIE_OPTIONS);
    return { csrfToken: token, csrfHmac: hmac };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || '';
    const userAgent = req.headers?.['user-agent'] || '';
    const result = await this.authService.login(dto, ip, userAgent);
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    return {
      accessToken: result.accessToken,
      user: result.user,
      requiresTwoFactor: result.requiresTwoFactor,
    };
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Public()
  @UseGuards(CsrfGuard)
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
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser('id') userId: string, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(userId);
    res.clearCookie('refreshToken', { path: '/' });
    res.clearCookie('csrf-token', { path: '/' });
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  async getSessions(@CurrentUser('id') userId: string, @Req() req: Request) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastActivity: 'desc' },
      select: {
        id: true,
        device: true,
        ip: true,
        location: true,
        lastActivity: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    const currentSessionId = (req as any).sessionId;
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
    const session = await this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) {
      throw new UnauthorizedException('Session not found');
    }
    await this.prisma.userSession.delete({ where: { id: sessionId } });
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllSessions(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Req() req: any,
  ) {
    await this.prisma.userSession.deleteMany({ where: { userId } });
  }

  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Public()
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
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Your password has been reset successfully.' };
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2fa(@CurrentUser('id') userId: string, @Body() dto: Verify2faDto) {
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

  @UseGuards(JwtAuthGuard)
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
  @Post('2fa/authenticate')
  @HttpCode(HttpStatus.OK)
  async authenticate2fa(@Body() dto: Verify2faDto, @CurrentUser('id') userId?: string) {
    return this.authService.verify2faToken(dto);
  }

  @Public()
  @Get('google/status')
  googleStatus() {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    return { configured: !!(clientId && clientId !== '...') };
  }

  @Public()
  @UseGuards(AuthGuard('google'))
  @Get('google')
  googleAuth() {
    // Guard handles redirect to Google
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('APP_URL') || 'http://localhost:5173';
    passport.authenticate('google', { session: false }, (err: any, user: any, info: any) => {
      if (err || !user) {
        let error = 'google_auth_failed';
        if (!user && info && info.message === 'access_denied') error = 'access_denied';
        else if (err?.message === 'Email not verified') error = 'email_not_verified';
        else if (err?.message === 'Domain not found') error = 'account_not_found';
        return res.redirect(`${frontendUrl}/auth/callback?error=${error}`);
      }
      const tokenParam = encodeURIComponent(user.accessToken);
      res.cookie('refreshToken', user.refreshToken, REFRESH_COOKIE_OPTIONS);
      return res.redirect(`${frontendUrl}/auth/callback#accessToken=${tokenParam}`);
    })(req, res);
  }
}
