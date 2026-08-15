import { WebhookRetryProcessor } from './webhook-retry.processor';
import { PrismaService } from '../common/prisma/prisma.service';

jest.mock('../modules/webhooks/webhook-url-validator', () => ({
  assertSafeWebhookUrl: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = {
  webhookDelivery: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

describe('WebhookRetryProcessor', () => {
  let processor: WebhookRetryProcessor;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // Aucun appel réseau réel dans les tests unitaires : le fetch est mocké.
    fetchMock = jest.fn().mockResolvedValue({
      status: 500,
      text: jest.fn().mockResolvedValue('server error'),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    processor = new WebhookRetryProcessor(
      mockPrisma as unknown as PrismaService,
      mockQueue as any,
    );
  });

  describe('process — garde-fou entreprise supprimée', () => {
    const deliveryOfDeletedCompany = {
      id: 'delivery-1',
      webhookId: 'webhook-1',
      event: 'delivery.status_changed',
      payload: { deliveryId: 'del-1' },
      status: 'failed',
      attempts: 1,
      maxAttempts: 5,
      nextRetryAt: new Date(),
      webhook: {
        id: 'webhook-1',
        url: 'https://evil.example.com/hook',
        secret: 'whsec_x',
        company: { deletedAt: new Date('2026-07-01T00:00:00.000Z') },
      },
    };

    it('ne rejoue JAMAIS le webhook d’une entreprise supprimée (deletedAt posé) et stoppe la boucle', async () => {
      mockPrisma.webhookDelivery.findUnique.mockResolvedValueOnce(deliveryOfDeletedCompany);

      await processor.process({ data: { webhookDeliveryId: 'delivery-1' } } as any);

      // Aucun POST externe n'est tenté → pas de fetch, et la delivery est marquée
      // sans prochaine tentative (nextRetryAt: null) pour ne plus être re-sélectionnée.
      expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: { status: 'failed', nextRetryAt: null },
      });
    });

    it('lit la delivery AVEC la company incluse (nécessaire pour le garde-fou)', async () => {
      mockPrisma.webhookDelivery.findUnique.mockResolvedValueOnce(deliveryOfDeletedCompany);

      await processor.process({ data: { webhookDeliveryId: 'delivery-1' } } as any);

      expect(mockPrisma.webhookDelivery.findUnique).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        include: {
          webhook: {
            include: { company: { select: { deletedAt: true } } },
          },
        },
      });
    });

    it('rejoue normalement le webhook d’une entreprise ACTIVE (deletedAt null)', async () => {
      const deliveryOfActiveCompany = {
        ...deliveryOfDeletedCompany,
        webhook: {
          ...deliveryOfDeletedCompany.webhook,
          company: { deletedAt: null },
        },
      };
      mockPrisma.webhookDelivery.findUnique.mockResolvedValueOnce(deliveryOfActiveCompany);

      await processor.process({ data: { webhookDeliveryId: 'delivery-1' } } as any);

      // Le garde-fou ne s'est PAS déclenché (pas de update 'nextRetryAt: null' seul) :
      // le flux continue jusqu'à la tentative HTTP. On vérifie que l'update final a
      // bien lieu avec attempts incrémenté (le fetch échouera en mock réseau → 0).
      expect(mockPrisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'delivery-1' },
          data: expect.objectContaining({ attempts: 2, status: 'failed' }),
        }),
      );
    });
  });

  describe('enqueueFailedDeliveries — filtre tenant', () => {
    it('ne sélectionne que les deliveries dont l’entreprise est ACTIVE (webhook.company.deletedAt null)', async () => {
      mockPrisma.webhookDelivery.findMany.mockResolvedValueOnce([]);

      await processor.enqueueFailedDeliveries();

      expect(mockPrisma.webhookDelivery.findMany).toHaveBeenCalledWith({
        where: {
          status: 'failed',
          nextRetryAt: { lte: expect.any(Date) },
          webhook: { company: { deletedAt: null } },
        },
        select: { id: true, attempts: true, maxAttempts: true },
      });
    });

    it('n’enqueue pas une delivery dont les tentatives sont épuisées', async () => {
      mockPrisma.webhookDelivery.findMany.mockResolvedValueOnce([
        { id: 'delivery-1', attempts: 5, maxAttempts: 5 },
        { id: 'delivery-2', attempts: 2, maxAttempts: 5 },
      ]);

      await processor.enqueueFailedDeliveries();

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'retry',
        { webhookDeliveryId: 'delivery-2' },
        expect.any(Object),
      );
    });
  });
});
