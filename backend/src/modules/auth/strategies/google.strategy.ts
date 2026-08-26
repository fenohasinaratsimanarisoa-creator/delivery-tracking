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

    const appUrl = (configService.get<string>('APP_URL') || 'http://localhost:5173').replace(
      /\/+$/,
      '',
    );
    // `.get(key, default)` ne retombe sur `default` QUE si la clé est absente —
    // pas si elle vaut '' (cas réel : .env.*.example livre GOOGLE_CALLBACK_URL=
    // vide "pour auto-dériver de APP_URL", mais la variable EXISTE quand même
    // dans l'environnement une fois le fichier chargé). Constaté en prod
    // (Contabo) : callbackURL vide envoyé à passport-google-oauth20, OAuth
    // cassé silencieusement. Même style que clientID/clientSecret ci-dessus.
    const callbackURL =
      configService.get<string>('GOOGLE_CALLBACK_URL') || `${appUrl}/api/auth/google/callback`;

    // Derrière un reverse proxy (nginx/Render), les headers X-Forwarded-* indiquent
    // le vrai protocole (https) et l'hôte. Sans proxy:true, Passport construit
    // l'callback URL en http:// au lieu de https:// → redirect_uri_mismatch Google.
    const useProxy = process.env.NODE_ENV === 'production';

    Logger.log(
      `Google OAuth — callbackURL: ${callbackURL}, proxy: ${useProxy}, APP_URL: ${appUrl}`,
      'GoogleStrategy',
    );

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
      proxy: useProxy,
      // Expose req au validate : ip/user-agent sont propagés à la UserSession
      // (sinon les sessions OAuth apparaissent sans device/ip dans « Mes sessions »).
      passReqToCallback: true as const,
    });
  }

  async validate(
    req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
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

    const result = await this.authService.validateGoogleUser(
      {
        googleId: profile.id,
        email,
        firstName: profile.name?.givenName || '',
        lastName: profile.name?.familyName || '',
      },
      req.ip || '',
      (req.headers?.['user-agent'] as string) || '',
    );

    return result;
  }
}
