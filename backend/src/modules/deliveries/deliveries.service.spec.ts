import { Test, TestingModule } from '@nestjs/testing';
import { DeliveryStatus } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('DeliveriesService - State Machine', () => {
  let service: DeliveriesService;
  let prisma: PrismaService;

  const mockPrisma = {
    delivery: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockNotifications = {
    create: jest.fn(),
    findAll: jest.fn(),
    countUnread: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
  };

  const mockWebhooks = {
    dispatch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: WebhooksService, useValue: mockWebhooks },
      ],
    }).compile();

    service = module.get<DeliveriesService>(DeliveriesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('isValidTransition', () => {
    const validCases: [DeliveryStatus, DeliveryStatus][] = [
      [DeliveryStatus.pending, DeliveryStatus.assigned],
      [DeliveryStatus.pending, DeliveryStatus.cancelled],
      [DeliveryStatus.assigned, DeliveryStatus.in_progress],
      [DeliveryStatus.assigned, DeliveryStatus.cancelled],
      [DeliveryStatus.in_progress, DeliveryStatus.delivered],
      [DeliveryStatus.in_progress, DeliveryStatus.failed],
      [DeliveryStatus.in_progress, DeliveryStatus.cancelled],
    ];

    const invalidCases: [DeliveryStatus, DeliveryStatus][] = [
      [DeliveryStatus.pending, DeliveryStatus.delivered],
      [DeliveryStatus.pending, DeliveryStatus.in_progress],
      [DeliveryStatus.pending, DeliveryStatus.failed],
      [DeliveryStatus.assigned, DeliveryStatus.delivered],
      [DeliveryStatus.assigned, DeliveryStatus.failed],
      [DeliveryStatus.delivered, DeliveryStatus.pending],
      [DeliveryStatus.delivered, DeliveryStatus.assigned],
      [DeliveryStatus.delivered, DeliveryStatus.in_progress],
      [DeliveryStatus.delivered, DeliveryStatus.failed],
      [DeliveryStatus.delivered, DeliveryStatus.cancelled],
      [DeliveryStatus.failed, DeliveryStatus.delivered],
      [DeliveryStatus.failed, DeliveryStatus.pending],
      [DeliveryStatus.failed, DeliveryStatus.assigned],
      [DeliveryStatus.cancelled, DeliveryStatus.pending],
      [DeliveryStatus.cancelled, DeliveryStatus.assigned],
      [DeliveryStatus.cancelled, DeliveryStatus.in_progress],
      [DeliveryStatus.cancelled, DeliveryStatus.delivered],
      [DeliveryStatus.cancelled, DeliveryStatus.failed],
    ];

    validCases.forEach(([from, to]) => {
      it(`should allow transition ${from} -> ${to}`, () => {
        expect(DeliveriesService.isValidTransition(from, to)).toBe(true);
      });
    });

    invalidCases.forEach(([from, to]) => {
      it(`should reject transition ${from} -> ${to}`, () => {
        expect(DeliveriesService.isValidTransition(from, to)).toBe(false);
      });
    });
  });
});
