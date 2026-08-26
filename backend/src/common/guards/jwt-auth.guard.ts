import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * PAS enregistré comme APP_GUARD global (vérifié dans app.module.ts : seuls
 * ThrottlerGuard et CsrfGuard le sont) — malgré ce qu'un commentaire ici
 * affirmait précédemment. La protection dépend donc entièrement du fait que
 * chaque contrôleur applique `@UseGuards(JwtAuthGuard)` lui-même ; `@Public()`
 * n'a d'effet que sur les contrôleurs qui l'appliquent déjà. Vérifié le
 * 2026-08-26 : tous les contrôleurs métier le font sauf health/geocoding/
 * mobile-app, qui sont volontairement publics (`@Public()` posé dessus) — pas
 * de trou d'auth actif aujourd'hui, mais un nouveau contrôleur qui oublie
 * `@UseGuards(JwtAuthGuard)` devient silencieusement public, sans filet.
 * Faire de ce guard un APP_GUARD global fermerait ce risque, mais impose de
 * revérifier au préalable que CHAQUE route publique porte bien `@Public()`
 * (health, geocoding, mobile-app, auth, billing webhooks, invitations,
 * tracking public, platform-admin login) — à traiter comme un changement dédié,
 * pas en passant.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or expired token');
    }
    return user;
  }
}
