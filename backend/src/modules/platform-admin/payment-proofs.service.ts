import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentProofStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { generateActivationCode } from '../../common/utils/activation-code.util';
import { normalizePagination } from '../../common/utils/pagination';

const ACTIVATION_CODE_VALIDITY_MS = 14 * 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentProofsService {
  private readonly logger = new Logger(PaymentProofsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  async list(status: PaymentProofStatus | undefined, page?: unknown, limit?: unknown) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    const where = status ? { status } : {};

    const [items, total] = await Promise.all([
      this.prisma.paymentProof.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, email: true } },
          claimedPlan: { select: { id: true, name: true, price: true, currency: true } },
          paymentMethod: { select: { provider: true, phoneNumber: true, holderName: true } },
          submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
      }),
      this.prisma.paymentProof.count({ where }),
    ]);

    return { items, total, page: p, limit: l, totalPages: Math.ceil(total / l) || 1 };
  }

  async getImage(id: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      select: { proofImage: true, proofImageMime: true },
    });
    if (!proof) throw new NotFoundException('Preuve introuvable');
    return proof;
  }

  async approve(id: string, adminId: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: { company: true, claimedPlan: true, submittedBy: true },
    });
    if (!proof) throw new NotFoundException('Preuve introuvable');
    if (proof.status !== 'pending') {
      throw new BadRequestException('Cette preuve a déjà été traitée');
    }

    const { code, prefix, hash } = generateActivationCode();
    const expiresAt = new Date(Date.now() + ACTIVATION_CODE_VALIDITY_MS);

    await this.prisma.paymentProof.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedById: adminId,
        reviewedAt: new Date(),
        activationCodeHash: hash,
        activationCodePrefix: prefix,
        activationExpiresAt: expiresAt,
      },
    });

    if (proof.company.email) {
      // Le code complet n'est JAMAIS repersisté en clair (seul son hash l'est) —
      // cet email est donc le seul moyen automatique de le transmettre au client.
      // Avant, il n'était renvoyé qu'à l'admin dans cette réponse HTTP, à charge
      // pour lui de le retransmettre à l'oral/SMS — irritant et source d'erreur
      // à chaque paiement, corrigé en l'envoyant directement au client.
      this.emailService
        .sendPaymentProofApproved(
          proof.company.email,
          proof.submittedBy.firstName,
          proof.claimedPlan.name,
          code,
          expiresAt,
        )
        .catch((err) => this.logger.error('sendPaymentProofApproved failed', err));
    }

    this.logger.log(`Preuve approuvée : proof=${id} company=${proof.companyId} admin=${adminId}`);

    // Toujours renvoyé à l'admin aussi (affiché à l'écran) : filet de secours si
    // l'envoi d'email échoue silencieusement (catch ci-dessus) ou que l'admin
    // veut le communiquer plus vite par un autre canal (SMS/oral).
    return { code, expiresAt };
  }

  async reject(id: string, adminId: string, reason: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { id },
      include: { company: true, submittedBy: true },
    });
    if (!proof) throw new NotFoundException('Preuve introuvable');
    if (proof.status !== 'pending') {
      throw new BadRequestException('Cette preuve a déjà été traitée');
    }

    await this.prisma.paymentProof.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: reason,
      },
    });

    if (proof.company.email) {
      this.emailService
        .sendPaymentProofRejected(proof.company.email, proof.submittedBy.firstName, reason)
        .catch((err) => this.logger.error('sendPaymentProofRejected failed', err));
    }

    this.logger.log(`Preuve rejetée : proof=${id} company=${proof.companyId} admin=${adminId}`);
  }
}
