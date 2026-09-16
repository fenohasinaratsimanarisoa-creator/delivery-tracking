import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ManualBillingService } from './manual-billing.service';
import { hashActivationCode } from '../../common/utils/activation-code.util';

const mockPrisma: any = {
  $transaction: jest.fn((arg: any): Promise<any> =>
    Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma),
  ),
  subscription: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  billingPlan: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  platformPaymentMethod: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  paymentProof: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    fieldname: 'image',
    originalname: 'proof.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.from('fake-image'),
    ...overrides,
  }) as Express.Multer.File;

describe('ManualBillingService', () => {
  let service: ManualBillingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ManualBillingService(mockPrisma as unknown as PrismaService);
  });

  describe('getStatus', () => {
    it("retourne status null quand la société n'a aucune Subscription", async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.getStatus('c1')).resolves.toEqual({
        status: null,
        trialEndsAt: null,
        daysRemaining: null,
        currentPlan: null,
      });
    });

    it("calcule daysRemaining sur trialEndsAt pendant l'essai et inclut le forfait courant", async () => {
      const trialEndsAt = new Date(Date.now() + 3 * 86_400_000);
      mockPrisma.subscription.findUnique.mockResolvedValue({
        status: 'trialing',
        trialEndsAt,
        currentPeriodEnd: trialEndsAt,
        plan: { id: 'plan-enterprise', tier: 'enterprise', name: 'Business' },
      });
      const result = await service.getStatus('c1');
      expect(result.status).toBe('trialing');
      expect(result.daysRemaining).toBeGreaterThanOrEqual(2);
      expect(result.daysRemaining).toBeLessThanOrEqual(3);
      expect(result.currentPlan).toEqual({
        id: 'plan-enterprise',
        tier: 'enterprise',
        name: 'Business',
      });
    });
  });

  describe('submitProof', () => {
    const dto = { claimedPlanId: 'plan-1', paymentMethodId: 'method-1', reference: 'REF123' };

    it('refuse sans fichier', async () => {
      await expect(service.submitProof('c1', 'u1', dto, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse un mimetype non autorisé', async () => {
      await expect(
        service.submitProof('c1', 'u1', dto, makeFile({ mimetype: 'application/pdf' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un fichier trop volumineux (> 5 Mo)', async () => {
      await expect(
        service.submitProof('c1', 'u1', dto, makeFile({ size: 6 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse si le plan réclamé est introuvable/inactif', async () => {
      mockPrisma.billingPlan.findFirst.mockResolvedValue(null);
      await expect(service.submitProof('c1', 'u1', dto, makeFile())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuse si le moyen de paiement est introuvable/inactif', async () => {
      mockPrisma.billingPlan.findFirst.mockResolvedValue({ id: 'plan-1', price: 35000 });
      mockPrisma.platformPaymentMethod.findFirst.mockResolvedValue(null);
      await expect(service.submitProof('c1', 'u1', dto, makeFile())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("refuse (pré-check) si une preuve 'pending' existe déjà pour la société", async () => {
      mockPrisma.billingPlan.findFirst.mockResolvedValue({ id: 'plan-1', price: 35000 });
      mockPrisma.platformPaymentMethod.findFirst.mockResolvedValue({ id: 'method-1' });
      mockPrisma.paymentProof.findFirst.mockResolvedValue({ id: 'existing-pending' });
      await expect(service.submitProof('c1', 'u1', dto, makeFile())).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.paymentProof.create).not.toHaveBeenCalled();
    });

    it('crée la preuve avec le prix du plan comme claimedAmount (instantané)', async () => {
      mockPrisma.billingPlan.findFirst.mockResolvedValue({ id: 'plan-1', price: 35000 });
      mockPrisma.platformPaymentMethod.findFirst.mockResolvedValue({ id: 'method-1' });
      mockPrisma.paymentProof.findFirst.mockResolvedValue(null);
      mockPrisma.paymentProof.create.mockResolvedValue({ id: 'proof-1' });

      await service.submitProof('c1', 'u1', dto, makeFile());

      expect(mockPrisma.paymentProof.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'c1',
          submittedById: 'u1',
          claimedPlanId: 'plan-1',
          claimedAmount: 35000,
          paymentMethodId: 'method-1',
          reference: 'REF123',
          proofImageMime: 'image/jpeg',
          status: 'pending',
        }),
      });
    });

    it('convertit le backstop P2002 (course concurrente) en ConflictException', async () => {
      mockPrisma.billingPlan.findFirst.mockResolvedValue({ id: 'plan-1', price: 35000 });
      mockPrisma.platformPaymentMethod.findFirst.mockResolvedValue({ id: 'method-1' });
      mockPrisma.paymentProof.findFirst.mockResolvedValue(null);
      mockPrisma.paymentProof.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(service.submitProof('c1', 'u1', dto, makeFile())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('redeem', () => {
    it('code introuvable → NotFoundException', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue(null);
      await expect(service.redeem('c1', 'PAY-ABCD1234')).rejects.toThrow(NotFoundException);
    });

    it('cherche par le hash normalisé du code fourni', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue(null);
      await expect(service.redeem('c1', ' pay-abcd1234 ')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.paymentProof.findUnique).toHaveBeenCalledWith({
        where: { activationCodeHash: hashActivationCode('PAY-ABCD1234') },
      });
    });

    it('refuse un code appartenant à une AUTRE société (jamais cross-tenant)', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'proof-1',
        companyId: 'other-company',
        redeemedAt: null,
        activationExpiresAt: new Date(Date.now() + 86_400_000),
      });
      await expect(service.redeem('c1', 'PAY-ABCD1234')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuse un code déjà utilisé', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'proof-1',
        companyId: 'c1',
        redeemedAt: new Date(),
        activationExpiresAt: new Date(Date.now() + 86_400_000),
      });
      await expect(service.redeem('c1', 'PAY-ABCD1234')).rejects.toThrow(BadRequestException);
    });

    it('refuse un code expiré', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'proof-1',
        companyId: 'c1',
        redeemedAt: null,
        activationExpiresAt: new Date(Date.now() - 1000),
      });
      await expect(service.redeem('c1', 'PAY-ABCD1234')).rejects.toThrow(BadRequestException);
    });

    it('active la Subscription sur le plan réclamé et marque le code utilisé', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'proof-1',
        companyId: 'c1',
        claimedPlanId: 'plan-1',
        redeemedAt: null,
        activationExpiresAt: new Date(Date.now() + 86_400_000),
      });
      mockPrisma.paymentProof.update.mockResolvedValue({});
      mockPrisma.subscription.upsert.mockResolvedValue({ status: 'active', planId: 'plan-1' });

      const result = await service.redeem('c1', 'PAY-ABCD1234');

      expect(mockPrisma.paymentProof.update).toHaveBeenCalledWith({
        where: { id: 'proof-1' },
        data: { redeemedAt: expect.any(Date) },
      });
      expect(mockPrisma.subscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'c1' },
          update: expect.objectContaining({
            planId: 'plan-1',
            status: 'active',
            provider: 'manual',
          }),
          create: expect.objectContaining({
            companyId: 'c1',
            planId: 'plan-1',
            status: 'active',
            provider: 'manual',
          }),
        }),
      );
      expect(result).toEqual({ status: 'active', planId: 'plan-1' });
    });
  });
});
