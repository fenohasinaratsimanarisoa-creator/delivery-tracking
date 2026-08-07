import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard Google OAuth qui relaie le paramètre `state` (nonce émis par
 * `POST /auth/oauth/begin`) vers l'URL d'autorisation Google, afin qu'il fasse
 * l'aller-retour et soit vérifié au callback. Sans `state` (flux web), Google
 * n'est pas invoqué avec un state (comportement existant).
 */
@Injectable()
export class GoogleAuthStateGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
    const req = context.switchToHttp().getRequest<{ query?: Record<string, unknown> }>();
    const state = req.query?.state;
    return {
      session: false,
      state: typeof state === 'string' && state.length > 0 ? state : undefined,
    };
  }
}
