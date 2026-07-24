import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(
    configService: ConfigService,
    private authService: AuthService,
  ) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID') || 'unconfigured';
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET') || 'unconfigured';

    if (clientID === 'unconfigured' || clientSecret === 'unconfigured') {
      console.warn('Google OAuth not configured — strategy will be inactive');
    }

    const appUrl = (configService.get<string>('APP_URL') || 'http://localhost:5173').replace(/\/+$/, '');
    const callbackURL = configService.get<string>(
      'GOOGLE_CALLBACK_URL',
      `${appUrl}/api/auth/google/callback`,
    );

    Logger.log(`Google OAuth callback URL: ${callbackURL}`, 'GoogleStrategy');

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: {
      id: string;
      emails?: { value: string; verified: boolean }[];
      name?: { givenName?: string; familyName?: string };
    },
  ) {
    const email = profile.emails?.[0]?.value;
    const emailVerified = profile.emails?.[0]?.verified;

    if (!email) {
      throw new Error('Google account has no email');
    }

    if (!emailVerified) {
      throw new Error('Email not verified');
    }

    const result = await this.authService.validateGoogleUser({
      googleId: profile.id,
      email,
      firstName: profile.name?.givenName || '',
      lastName: profile.name?.familyName || '',
    });

    return result;
  }
}
