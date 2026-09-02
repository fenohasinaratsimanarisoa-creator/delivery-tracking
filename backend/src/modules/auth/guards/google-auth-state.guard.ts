import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { randomBytes } from 'crypto';
import type { Request, Response } from 'express';

export const OAUTH_WEB_STATE_COOKIE = 'oauth_state';
const OAUTH_WEB_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Guard Google OAuth — gère le paramètre `state` selon le flux :
 *
 *  - **Flux natif** (`?state=<relayId>` déjà présent, émis par
 *    `POST /auth/oauth/begin`) : on relaie ce nonce tel quel. Sa validation au
 *    callback passe par OAuthRelayService + PKCE.
 *
 *  - **Flux web** (aucun `state` entrant) : AVANT, Google était invoqué SANS
 *    state → aucune protection CSRF de connexion. Un attaquant pouvait faire
 *    compléter l'OAuth avec SON compte dans le navigateur de la victime
 *    (fixation de session). On génère maintenant un nonce, on le pose en cookie
 *    httpOnly `oauth_state` (SameSite=Lax : renvoyé sur la navigation top-level
 *    de retour depuis Google), et `googleCallback` exige que le `state` renvoyé
 *    par Google corresponde à ce cookie.
 */
@Injectable()
export class GoogleAuthStateGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext): Record<string, unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const incoming = req.query?.state;
    if (typeof incoming === 'string' && incoming.length > 0) {
      // Flux natif : nonce relayId déjà fourni, on ne touche pas au cookie web.
      return { session: false, state: incoming };
    }

    // Flux web : nonce anti-CSRF de connexion.
    const nonce = randomBytes(32).toString('hex');
    const secure = (process.env.APP_URL || '').startsWith('https://');
    res.cookie(OAUTH_WEB_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: OAUTH_WEB_STATE_TTL_MS,
      path: '/',
    });
    return { session: false, state: nonce };
  }
}
