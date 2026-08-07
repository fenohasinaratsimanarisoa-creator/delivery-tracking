import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WebhooksService } from './webhooks.service';

jest.mock('./webhook-url-validator', () => ({
  assertSafeWebhookUrl: jest.fn().mockResolvedValue(undefined),
}));

const { assertSafeWebhookUrl } = jest.requireMock('./webhook-url-validator');

const mockPrisma = {
  webhook: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  webhookDelivery: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhooksService(mockPrisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a webhook with a generated secret', async () => {
      const created = {
        id: 'webhook-1',
        secret: 'whsec_abc',
        url: 'https://example.com/webhook',
        events: ['delivery.status_changed'],
        isActive: true,
      };
      mockPrisma.webhook.create.mockResolvedValueOnce(created);

      const result = await service.create('company-1', {
        url: 'https://example.com/webhook',
        events: ['delivery.status_changed'],
      });

      expect(assertSafeWebhookUrl).toHaveBeenCalledWith('https://example.com/webhook');
      expect(result).toMatchObject({
        id: 'webhook-1',
        url: 'https://example.com/webhook',
        events: ['delivery.status_changed'],
      });
      expect(result.secret).toMatch(/^whsec_/);
      expect(mockPrisma.webhook.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          url: 'https://example.com/webhook',
        }),
      });
    });

    it('rejects SSRF URLs like http://169.254.169.254', async () => {
      assertSafeWebhookUrl.mockRejectedValueOnce(
        new BadRequestException('Webhook URL must use HTTPS protocol'),
      );

      await expect(
        service.create('company-1', {
          url: 'http://169.254.169.254/latest/meta-data/',
          events: ['delivery.status_changed'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.webhook.create).not.toHaveBeenCalled();
    });

    it('rejects SSRF URLs like http://127.0.0.1:6379', async () => {
      assertSafeWebhookUrl.mockRejectedValueOnce(
        new BadRequestException('Webhook URL must use HTTPS protocol'),
      );

      await expect(
        service.create('company-1', {
          url: 'http://127.0.0.1:6379',
          events: ['delivery.status_changed'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.webhook.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns all webhooks for a company with recent deliveries', async () => {
      const webhooks = [{ id: 'webhook-1', deliveries: [] }];
      mockPrisma.webhook.findMany.mockResolvedValueOnce(webhooks);

      const result = await service.findAll('company-1');

      expect(result).toEqual(webhooks);
      expect(mockPrisma.webhook.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        include: expect.objectContaining({
          deliveries: expect.objectContaining({ take: 5 }),
        }),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns a webhook scoped to the company', async () => {
      const webhook = { id: 'webhook-1', companyId: 'company-1', deliveries: [] };
      mockPrisma.webhook.findFirst.mockResolvedValueOnce(webhook);

      const result = await service.findOne('company-1', 'webhook-1');

      expect(result).toEqual(webhook);
    });

    it('throws when the webhook is not found in the company scope', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a webhook owned by the company with URL validation', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce({
        id: 'webhook-1',
        companyId: 'company-1',
      });
      mockPrisma.webhook.update.mockResolvedValueOnce({
        id: 'webhook-1',
        url: 'https://example.com/updated',
        events: ['delivery.delivered'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.update('company-1', 'webhook-1', {
        url: 'https://example.com/updated',
        events: ['delivery.delivered'],
      });

      expect(assertSafeWebhookUrl).toHaveBeenCalledWith('https://example.com/updated');
      expect(result.url).toBe('https://example.com/updated');
      expect(mockPrisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
        data: { url: 'https://example.com/updated', events: ['delivery.delivered'] },
        select: expect.objectContaining({ id: true, url: true }),
      });
    });

    it('throws when the webhook is not found', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update('company-1', 'missing', { url: 'https://example.com/new' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes a webhook owned by the company', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce({
        id: 'webhook-1',
        companyId: 'company-1',
      });
      mockPrisma.webhook.delete.mockResolvedValueOnce({ id: 'webhook-1' });

      await service.remove('company-1', 'webhook-1');

      expect(mockPrisma.webhook.delete).toHaveBeenCalledWith({ where: { id: 'webhook-1' } });
    });

    it('throws when the webhook is not found', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('toggle', () => {
    it('flips the isActive flag', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValueOnce({
        id: 'webhook-1',
        companyId: 'company-1',
        isActive: true,
      });
      mockPrisma.webhook.update.mockResolvedValueOnce({ id: 'webhook-1', isActive: false });

      const result = await service.toggle('company-1', 'webhook-1');

      expect(result.isActive).toBe(false);
      expect(mockPrisma.webhook.update).toHaveBeenCalledWith({
        where: { id: 'webhook-1' },
        data: { isActive: false },
        select: { id: true, isActive: true },
      });
    });
  });
});
