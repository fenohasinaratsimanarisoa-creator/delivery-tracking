import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsageGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const billingEnabled = this.configService.get<string>('BILLING_ENABLED') === 'true';
    if (!billingEnabled) return true;

    const request = context.switchToHttp().getRequest();
    const companyId = request.companyId || request.user?.companyId;
    if (!companyId) return true;

    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });

    if (!sub || !sub.plan) {
      const freePlan = await this.prisma.billingPlan.findUnique({ where: { tier: 'free' } });
      if (freePlan) {
        await this.enforceLimit(companyId, freePlan, request);
      }
      return true;
    }

    // Liste blanche explicite : seul un abonnement 'active' (payé) donne accès aux
    // limites de son plan. Tout autre statut est bloqué :
    //  - 'incomplete' : checkout créé mais jamais payé
    //  - 'past_due'   : paiement en échec (facture impayée / période dépassée)
    //  - 'unpaid'     : impayé après la période de grâce
    //  - 'canceled'   : résilié
    // Période de grâce sur 'past_due' : décision assumée de NE PAS en accorder au
    // niveau du garde — le cron handleUnpaidSubscriptions laisse déjà 7 jours après
    // la fin de période avant de basculer en 'unpaid'. Bloquer immédiatement évite
    // qu'une entreprise en échec de paiement conserve les limites premium sans payer.
    // 'trialing' existe dans l'enum SubscriptionStatus mais n'est jamais utilisé dans
    // le code métier : volontairement exclu de la liste blanche.
    const PAYING_STATUSES = new Set(['active']);
    if (!PAYING_STATUSES.has(sub.status)) {
      throw new ForbiddenException(
        'Votre abonnement est suspendu. Rendez-vous dans la section Facturation pour le réactiver.',
      );
    }

    await this.enforceLimit(companyId, sub.plan, request);
    return true;
  }

  private async enforceLimit(companyId: string, plan: any, request: any): Promise<void> {
    const path = request.route?.path || '';

    if (path.includes('/deliveries') && request.method === 'POST') {
      const limit = plan.maxDeliveriesPerMonth;
      if (limit == null) return;

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const count = await this.prisma.delivery.count({
        where: {
          companyId,
          deletedAt: null,
          createdAt: { gte: startOfMonth },
        },
      });

      if (count >= limit) {
        throw new ForbiddenException(
          `Vous avez atteint la limite de ${limit} livraisons par mois de votre forfait ${plan.name}. ` +
            `Passez à un forfait supérieur pour continuer.`,
        );
      }
    }

    if (path.includes('/vehicles') && request.method === 'POST') {
      const limit = plan.maxVehicles;
      if (limit == null) return;

      const count = await this.prisma.vehicle.count({ where: { companyId, deletedAt: null } });

      if (count >= limit) {
        throw new ForbiddenException(
          `Vous avez atteint la limite de ${limit} véhicules de votre forfait ${plan.name}. ` +
            `Passez à un forfait supérieur pour ajouter plus de véhicules.`,
        );
      }
    }

    if (path.includes('/users') && request.method === 'POST') {
      const limit = plan.maxUsers;
      if (limit == null) return;

      const count = await this.prisma.user.count({
        where: { companyId, deletedAt: null, isActive: true },
      });

      if (count >= limit) {
        throw new ForbiddenException(
          `Vous avez atteint la limite de ${limit} utilisateurs de votre forfait ${plan.name}. ` +
            `Passez à un forfait supérieur pour ajouter plus d'utilisateurs.`,
        );
      }
    }
  }
}
