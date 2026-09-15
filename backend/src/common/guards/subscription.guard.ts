import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';
import { ManualPaymentRequiredException } from '../exceptions/manual-payment-required.exception';
import type { JwtPayload } from '../../modules/auth/interfaces/jwt-payload.interface';

// ─────────────────────────────────────────────────────────────────────────────
// PAIEMENT MANUEL 2026-09-15 — garde GLOBALE (3e APP_GUARD après ThrottlerGuard
// et CsrfGuard, voir app.module.ts) qui coupe l'accès d'une société dont
// l'essai/abonnement a expiré. Calquée sur CsrfGuard : garde globale + skip via
// Reflector, indépendante de BILLING_ENABLED (nouveau système parallèle, pas le
// Stripe/MVola dormant derrière usage.guard.ts, qu'on ne touche pas).
//
// BUG CORRIGÉ EN TESTANT EN PROD (2026-09-15) : une garde GLOBALE (APP_GUARD)
// s'exécute AVANT tout `@UseGuards(JwtAuthGuard, ...)` posé au niveau d'un
// contrôleur — JwtAuthGuard n'est PAS globale dans ce projet (chaque
// contrôleur l'applique lui-même, voir sa propre doc). Une première version
// lisait `request.user` ici : toujours vide à ce stade de l'exécution, donc
// cette garde ne bloquait RIEN, jamais, pour aucune route (silencieusement
// inerte — confirmé par un essai forcé expiré qui continuait à tout charger).
// Fix : décoder le JWT nous-mêmes depuis l'en-tête Authorization, même idiome
// que DeviceTrackingAuthGuard (qui a le même besoin, pour la même raison).
// jsonwebtoken en direct plutôt que JwtService (@nestjs/jwt) : JwtModule est
// enregistré dans AuthModule, pas globalement — l'injecter ici demanderait de
// l'importer aussi dans AppModule pour rien, jsonwebtoken suffit et est déjà
// une dépendance directe utilisée ailleurs (auth.service.ts).
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) return true;

    // Échec de décodage/vérification → on laisse simplement passer : cette
    // garde n'authentifie jamais personne, elle ajoute seulement une
    // restriction PAR-DESSUS une authentification déjà valide. JwtAuthGuard,
    // plus loin dans le pipeline, reste seul responsable de rejeter un token
    // invalide/expiré.
    let payload: JwtPayload;
    try {
      payload = jwt.verify(
        authHeader.slice(7).trim(),
        this.configService.get<string>('JWT_ACCESS_SECRET')!,
        {
          algorithms: ['HS256'],
        },
      ) as JwtPayload;
    } catch {
      return true;
    }

    // Admin plateforme (pas de companyId, ressource hors tenant) : rien à vérifier.
    if (payload.type === 'platform_admin' || !payload.companyId) return true;
    const companyId = payload.companyId;

    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });

    // Aucune ligne Subscription du tout : contrairement à usage.guard.ts (qui
    // retombe sur le plan gratuit — un manque de quota n'est pas grave), cette
    // garde contrôle l'ACCÈS lui-même : échouer « ouvert » désactiverait
    // silencieusement toute la fonctionnalité au moindre souci de seed/migration.
    if (!sub) throw new ManualPaymentRequiredException();

    const now = new Date();

    // Expiration paresseuse (même idiome que Invitation.findByToken qui bascule
    // le statut au moment de la lecture plutôt que de dépendre uniquement d'un
    // cron) : le statut stocké est corrigé dès qu'on constate qu'il a expiré.
    if (sub.status === 'trialing') {
      if (sub.trialEndsAt && sub.trialEndsAt < now) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'past_due' },
        });
        throw new ManualPaymentRequiredException();
      }
      return true;
    }

    if (sub.status === 'active') {
      if (sub.currentPeriodEnd < now) {
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'past_due' },
        });
        throw new ManualPaymentRequiredException();
      }
      return true;
    }

    // past_due / unpaid / canceled / incomplete.
    throw new ManualPaymentRequiredException();
  }
}
