import { Test, TestingModule } from '@nestjs/testing';
import { InvoicePdfService } from './invoice-pdf.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InvoiceStatus, BillingProvider, PlanTier } from '@prisma/client';
import * as zlib from 'zlib';

function extractPdfText(pdfBuffer: Buffer): string {
  const text = pdfBuffer.toString('binary');
  const streamMatches = text.match(/stream\n(.+?)endstream/gs) || [];
  let result = '';
  for (const match of streamMatches) {
    const raw = match.replace(/^stream\n/, '').replace(/\nendstream$/, '');
    try {
      const decompressed = zlib.inflateSync(Buffer.from(raw, 'binary'));
      const content = decompressed.toString('utf8');
      const hexMatches = content.match(/<([0-9A-Fa-f]+)>/g) || [];
      for (const h of hexMatches) {
        const hex = h.replace(/[<>]/g, '');
        result += Buffer.from(hex, 'hex').toString('latin1');
      }
      const parenMatches = content.match(/\(([^)]*)\)/g) || [];
      for (const p of parenMatches) {
        result += p.slice(1, -1);
      }
      result += '\n';
    } catch {
      result += raw + '\n';
    }
  }
  return result;
}

const mockPrisma = {
  invoice: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('InvoicePdfService', () => {
  let service: InvoicePdfService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [InvoicePdfService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<InvoicePdfService>(InvoicePdfService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('generateInvoice', () => {
    const mockInvoice = {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-00001',
      amount: 9900,
      currency: 'EUR',
      status: InvoiceStatus.paid,
      provider: BillingProvider.stripe,
      createdAt: new Date('2026-07-15'),
      pdfData: null,
      company: {
        id: 'comp-1',
        name: 'Test Company',
        email: 'billing@test.com',
        address: '123 Test St',
      },
      subscription: {
        id: 'sub-1',
        currentPeriodStart: new Date('2026-07-01'),
        currentPeriodEnd: new Date('2026-08-01'),
        plan: {
          id: 'plan-1',
          name: 'Pro Plan',
          tier: PlanTier.pro,
          interval: 'month',
        },
      },
    };

    it('should generate PDF and return buffer', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({
        ...mockInvoice,
        pdfData: Buffer.from('pdf'),
      });

      const result = await service.generateInvoice('inv-1');

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
      expect(mockPrisma.invoice.findUnique).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        include: { company: true, subscription: { include: { plan: true } } },
      });
    });

    it('should return existing PDF data if already generated', async () => {
      const existingPdf = Buffer.from('existing-pdf-data');
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({ ...mockInvoice, pdfData: existingPdf });

      const result = await service.generateInvoice('inv-1');

      expect(result).toEqual(existingPdf);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('should throw error when invoice not found', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);

      await expect(service.generateInvoice('inv-nonexistent')).rejects.toThrow(
        'Invoice inv-nonexistent not found',
      );
    });

    it('should calculate correct amounts with 20% VAT', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('99.00 EUR'); // HT
      expect(pdfText).toContain('19.80 EUR'); // TVA
      expect(pdfText).toContain('118.80 EUR'); // TTC
    });

    it('should include company information in PDF', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('Test Company');
      expect(pdfText).toContain('billing@test.com');
    });

    it('should include subscription period in PDF', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('Période');
      expect(pdfText).toContain('Pro Plan');
    });

    it('should show correct payment method label for Stripe', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        ...mockInvoice,
        provider: BillingProvider.stripe,
      });
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('Carte bancaire (Stripe)');
    });

    it('should show correct payment method label for MVola', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        ...mockInvoice,
        provider: BillingProvider.mvola,
      });
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('Mobile Money (MVola)');
    });

    it('should show correct payment method label for Orange Money', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({
        ...mockInvoice,
        provider: BillingProvider.orange_money,
      });
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('Mobile Money (Orange Money)');
    });

    it('should include legal mentions in PDF', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      const result = await service.generateInvoice('inv-1');

      const pdfText = extractPdfText(result);
      expect(pdfText).toContain('LogiTrack Solutions');
      expect(pdfText).toContain('NIF');
      expect(pdfText).toContain('TVA intracommunautaire');
    });

    it('should save generated PDF to database', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(mockInvoice);
      mockPrisma.invoice.update.mockResolvedValueOnce({});

      await service.generateInvoice('inv-1');

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { pdfData: expect.any(Buffer) },
      });
    });
  });
});
