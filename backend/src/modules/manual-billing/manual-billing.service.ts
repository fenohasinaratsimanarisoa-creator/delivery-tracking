import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ALLOWED_IMAGE_MIME_TYPES } from '../../common/config/multer.config';
import { hashActivationCode } from '../../common/utils/activation-code.util';
import { SubmitPaymentProofDto } from './dto/submit-payment-proof.dto';

const MAX_PROOF_IMAGE_BYTES = 5 * 1024 * 1024;
const PAID_SUBSCRIPTION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ManualBillingService {
  private readonly logger = new Logger(ManualBillingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Statut d'essai/abonnement affiché au client (bandeau + paywall). Inclut le
   * forfait courant (`currentPlan`) pour que la page paywall puisse afficher
   * "vous êtes sur X" plutôt que de ne montrer que les 3 forfaits sans contexte
   * — utile aussi bien en blocage (essai expiré) qu'en changement volontaire
   * de forfait par un client déjà actif.
   */
  async getStatus(companyId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });
    if (!sub) return { status: null, trialEndsAt: null, daysRemaining: null, currentPlan: null };

    const now = Date.now();
    const referenceEnd = sub.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd;
    const daysRemaining = referenceEnd
      ? Math.max(0, Math.ceil((referenceEnd.getTime() - now) / 86_400_000))
      : null;

    return {
      status: sub.status,
      trialEndsAt: sub.trialEndsAt,
      daysRemaining,
      currentPlan: { id: sub.plan.id, tier: sub.plan.tier, name: sub.plan.name },
    };
  }

  async getPlans() {
    return this.prisma.billingPlan.findMany({
      where: { isActive: true, tier: { not: 'free' } },
      orderBy: { price: 'asc' },
    });
  }

  async getPaymentMethods() {
    return this.prisma.platformPaymentMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getMyProofs(companyId: string) {
    return this.prisma.paymentProof.findMany({
      where: { companyId },
      include: { claimedPlan: true, paymentMethod: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  async submitProof(
    companyId: string,
    userId: string,
    dto: SubmitPaymentProofDto,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Une capture de paiement est requise');
    if (!ALLOWED_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Type de fichier invalide — JPEG, PNG ou WebP uniquement');
    }
    if (file.size > MAX_PROOF_IMAGE_BYTES) {
      throw new BadRequestException('Image trop volumineuse (5 Mo maximum)');
    }

    const plan = await this.prisma.billingPlan.findFirst({
      where: { id: dto.claimedPlanId, isActive: true, tier: { not: 'free' } },
    });
    if (!plan) throw new NotFoundException('Forfait introuvable');

    const method = await this.prisma.platformPaymentMethod.findFirst({
      where: { id: dto.paymentMethodId, isActive: true },
    });
    if (!method) throw new NotFoundException('Moyen de paiement introuvable');

    // Pré-check applicatif (même idiome que InvitationsService.create) — l'index
    // unique partiel `payment_proofs_company_pending_unique` reste le filet
    // anti-concurrence en dernier recours (voir migration 20260915180000).
    const existingPending = await this.prisma.paymentProof.findFirst({
      where: { companyId, status: 'pending' },
    });
    if (existingPending) {
      throw new ConflictException(
        'Une preuve de paiement est déjà en attente de vérification pour votre société',
      );
    }

    try {
      return await this.prisma.paymentProof.create({
        data: {
          companyId,
          submittedById: userId,
          claimedPlanId: plan.id,
          claimedAmount: plan.price,
          paymentMethodId: method.id,
          reference: dto.reference.trim(),
          proofImage: file.buffer,
          proofImageMime: file.mimetype,
          status: 'pending',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Une preuve de paiement est déjà en attente de vérification pour votre société',
        );
      }
      throw err;
    }
  }

  async redeem(companyId: string, rawCode: string) {
    const hash = hashActivationCode(rawCode);
    const proof = await this.prisma.paymentProof.findUnique({
      where: { activationCodeHash: hash },
    });

    if (!proof) throw new NotFoundException('Code invalide');
    // Jamais cross-tenant, même si le code a fuité : il n'appartient qu'à la
    // société qui a soumis la preuve dont il découle.
    if (proof.companyId !== companyId) throw new NotFoundException('Code invalide');
    if (proof.redeemedAt) throw new BadRequestException('Ce code a déjà été utilisé');
    if (proof.activationExpiresAt && proof.activationExpiresAt < new Date()) {
      throw new BadRequestException('Ce code a expiré — contactez le support pour un nouveau code');
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + PAID_SUBSCRIPTION_DURATION_MS);

    const [, subscription] = await this.prisma.$transaction([
      this.prisma.paymentProof.update({
        where: { id: proof.id },
        data: { redeemedAt: now },
      }),
      this.prisma.subscription.upsert({
        where: { companyId },
        update: {
          planId: proof.claimedPlanId,
          status: 'active',
          provider: 'manual',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        create: {
          companyId,
          planId: proof.claimedPlanId,
          status: 'active',
          provider: 'manual',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
        include: { plan: true },
      }),
    ]);

    this.logger.log(`Abonnement manuel activé : company=${companyId} plan=${proof.claimedPlanId}`);
    return subscription;
  }
}
