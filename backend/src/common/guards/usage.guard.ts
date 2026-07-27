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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

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

    if (sub.status === 'canceled' || sub.status === 'unpaid') {
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
