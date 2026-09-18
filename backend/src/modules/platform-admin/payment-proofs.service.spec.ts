import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentProofsService } from './payment-proofs.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';

const mockPrisma = {
  paymentProof: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockEmailService = {
  sendPaymentProofApproved: jest.fn().mockResolvedValue(undefined),
  sendPaymentProofRejected: jest.fn().mockResolvedValue(undefined),
};

describe('PaymentProofsService', () => {
  let service: PaymentProofsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmailService.sendPaymentProofApproved.mockResolvedValue(undefined);
    mockEmailService.sendPaymentProofRejected.mockResolvedValue(undefined);
    service = new PaymentProofsService(
      mockPrisma as unknown as PrismaService,
      mockEmailService as unknown as EmailService,
    );
  });

  describe('list', () => {
    it('filtre par statut quand fourni', async () => {
      mockPrisma.paymentProof.findMany.mockResolvedValue([]);
      mockPrisma.paymentProof.count.mockResolvedValue(0);
      await service.list('pending' as any, 1, 20);
      expect(mockPrisma.paymentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'pending' } }),
      );
    });

    it('ne filtre pas si aucun statut', async () => {
      mockPrisma.paymentProof.findMany.mockResolvedValue([]);
      mockPrisma.paymentProof.count.mockResolvedValue(0);
      await service.list(undefined, 1, 20);
      expect(mockPrisma.paymentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('approve', () => {
    it('preuve introuvable → NotFoundException', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue(null);
      await expect(service.approve('p1', 'admin1')).rejects.toThrow(NotFoundException);
    });

    it('refuse de re-traiter une preuve déjà tranchée', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'p1',
        status: 'approved',
        company: { email: 'x@y.com' },
        claimedPlan: { name: 'Pro' },
        submittedBy: { firstName: 'A' },
      });
      await expect(service.approve('p1', 'admin1')).rejects.toThrow(BadRequestException);
    });

    it('génère un code, le stocke haché, et le renvoie UNE fois en clair', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'p1',
        companyId: 'c1',
        status: 'pending',
        company: { email: 'x@y.com' },
        claimedPlan: { name: 'Pro' },
        submittedBy: { firstName: 'A' },
      });
      mockPrisma.paymentProof.update.mockResolvedValue({});

      const result = await service.approve('p1', 'admin1');

      expect(result.code).toMatch(/^PAY-[A-Z0-9]{8}$/);
      expect(mockPrisma.paymentProof.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({
          status: 'approved',
          reviewedById: 'admin1',
          activationCodeHash: expect.any(String),
          activationCodePrefix: expect.any(String),
        }),
      });
      // Le code en clair ne doit JAMAIS apparaître dans les données persistées.
      const persistedData = mockPrisma.paymentProof.update.mock.calls[0][0].data;
      expect(persistedData.activationCodeHash).not.toBe(result.code);
      expect(JSON.stringify(persistedData)).not.toContain(result.code);
      expect(mockEmailService.sendPaymentProofApproved).toHaveBeenCalledWith(
        'x@y.com',
        'A',
        'Pro',
        result.code,
        expect.any(Date),
      );
    });

    it("n'envoie pas d'email si la société n'a pas d'adresse", async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'p1',
        companyId: 'c1',
        status: 'pending',
        company: { email: null },
        claimedPlan: { name: 'Pro' },
        submittedBy: { firstName: 'A' },
      });
      mockPrisma.paymentProof.update.mockResolvedValue({});
      await service.approve('p1', 'admin1');
      expect(mockEmailService.sendPaymentProofApproved).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('preuve introuvable → NotFoundException', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue(null);
      await expect(service.reject('p1', 'admin1', 'motif')).rejects.toThrow(NotFoundException);
    });

    it('enregistre le motif et notifie le client', async () => {
      mockPrisma.paymentProof.findUnique.mockResolvedValue({
        id: 'p1',
        companyId: 'c1',
        status: 'pending',
        company: { email: 'x@y.com' },
        submittedBy: { firstName: 'A' },
      });
      mockPrisma.paymentProof.update.mockResolvedValue({});

      await service.reject('p1', 'admin1', 'Référence introuvable');

      expect(mockPrisma.paymentProof.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: expect.objectContaining({
          status: 'rejected',
          reviewedById: 'admin1',
          rejectionReason: 'Référence introuvable',
        }),
      });
      expect(mockEmailService.sendPaymentProofRejected).toHaveBeenCalledWith(
        'x@y.com',
        'A',
        'Référence introuvable',
      );
    });
  });
});
