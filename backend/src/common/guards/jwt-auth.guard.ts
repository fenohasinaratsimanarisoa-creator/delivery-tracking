import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Enregistré comme APP_GUARD global (voir app.module.ts) : toute route est
 * authentifiée PAR DÉFAUT, `@Public()` est l'unique façon d'en sortir — même
 * pattern que CsrfGuard/@SkipCsrf(). Avant ce correctif, aucun guard global
 * n'existait : la protection dépendait entièrement du fait que chaque
 * contrôleur pense à ajouter `@UseGuards(JwtAuthGuard)` lui-même, et
 * `@Public()` n'était lu par personne (mort, purement documentaire) — un
 * nouveau contrôleur qui l'oubliait devenait silencieusement public.
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
