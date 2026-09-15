import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { SKIP_SUBSCRIPTION_CHECK_KEY } from '../decorators/skip-subscription-check.decorator';
import { ManualPaymentRequiredException } from '../exceptions/manual-payment-required.exception';

// ─────────────────────────────────────────────────────────────────────────────
// PAIEMENT MANUEL 2026-09-15 — garde GLOBALE (3e APP_GUARD après ThrottlerGuard
// et CsrfGuard, voir app.module.ts) qui coupe l'accès d'une société dont
// l'essai/abonnement a expiré. Calquée sur CsrfGuard : garde globale + skip via
// Reflector, indépendante de BILLING_ENABLED (nouveau système parallèle, pas le
// Stripe/MVola dormant derrière usage.guard.ts, qu'on ne touche pas).
//
// JwtAuthGuard N'EST PAS globale dans ce projet (chaque contrôleur l'applique
// lui-même) — cette garde tourne donc parfois AVANT que request.user existe :
// elle ne doit jamais bloquer une requête que l'authentification va de toute
// façon rejeter plus loin, elle se contente de laisser passer dans ce cas.
// ─────────────────────────────────────────────────────────────────────────────
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SUBSCRIPTION_CHECK_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    // Pas d'utilisateur, admin plateforme (pas de companyId), ou requête non-HTTP :
    // rien à vérifier ici, laisser passer (JwtAuthGuard/SuperAdminGuard tranchent).
    if (!user || user.type !== 'user' || !user.companyId) return true;

    const sub = await this.prisma.subscription.findUnique({ where: { companyId: user.companyId } });

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
