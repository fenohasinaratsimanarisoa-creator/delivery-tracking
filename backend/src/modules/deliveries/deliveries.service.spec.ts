import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';

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
    driver: {
      findFirst: jest.fn(),
    },
    vehicle: {
      findFirst: jest.fn(),
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
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveriesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: WebhooksService, useValue: mockWebhooks },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('false') } },
        { provide: DataUpdateBus, useValue: { emit: jest.fn(), emitUpdate: jest.fn(), on: jest.fn() } },
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

  describe('findOne (IDOR)', () => {
    const baseDelivery = {
      id: 'del-1', companyId: 'comp-1', title: 'Test Delivery',
      status: DeliveryStatus.pending, deletedAt: null,
      vehicle: null, driver: null,
    };

    it('should return delivery for admin/dispatcher (no role filter)', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(baseDelivery);
      const result = await service.findOne('comp-1', 'del-1');
      expect(result).toEqual(baseDelivery);
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'del-1', companyId: 'comp-1', deletedAt: null } }),
      );
    });

    it('should filter by clientId for client role', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(baseDelivery);
      await service.findOne('comp-1', 'del-1', 'client', 'client-123');
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'del-1', companyId: 'comp-1', deletedAt: null, clientId: 'client-123' } }),
      );
    });

    it('should filter by assignedDriverId for driver role', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(baseDelivery);
      await service.findOne('comp-1', 'del-1', 'driver', 'driver-123');
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'del-1', companyId: 'comp-1', deletedAt: null, assignedDriverId: 'driver-123' } }),
      );
    });

    it('should throw NotFoundException when delivery not found', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      await expect(service.findOne('comp-1', 'del-999')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update (status transitions)', () => {
    it('should reject invalid status transition pending -> delivered', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-1', companyId: 'comp-1', title: 'Test',
        status: DeliveryStatus.pending, deletedAt: null,
        vehicle: null, driver: null, deliveryLat: null, deliveryLng: null,
        assignedDriverId: null, clientId: null,
      });
      await expect(
        service.update('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid status transition pending -> in_progress', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-2', companyId: 'comp-1', title: 'Test',
        status: DeliveryStatus.pending, deletedAt: null,
        vehicle: null, driver: null, deliveryLat: null, deliveryLng: null,
        assignedDriverId: null, clientId: null,
      });
      await expect(
        service.update('comp-1', 'del-2', { status: DeliveryStatus.in_progress } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow valid transition pending -> assigned', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-3', companyId: 'comp-1', title: 'Test',
        status: DeliveryStatus.pending, deletedAt: null,
        vehicle: null, driver: null, deliveryLat: null, deliveryLng: null,
        assignedDriverId: null, clientId: null,
      });
      mockPrisma.delivery.update.mockResolvedValueOnce({
        id: 'del-3', status: DeliveryStatus.assigned,
      });
      const result = await service.update('comp-1', 'del-3', { status: DeliveryStatus.assigned } as any);
      expect(mockPrisma.delivery.update).toHaveBeenCalled();
      expect(result.status).toBe(DeliveryStatus.assigned);
    });

    it('should allow valid transition assigned -> cancelled', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-4', companyId: 'comp-1', title: 'Test',
        status: DeliveryStatus.assigned, deletedAt: null,
        vehicle: null, driver: null, deliveryLat: null, deliveryLng: null,
        assignedDriverId: null, clientId: null,
      });
      mockPrisma.delivery.update.mockResolvedValueOnce({
        id: 'del-4', status: DeliveryStatus.cancelled,
      });
      const result = await service.update('comp-1', 'del-4', { status: DeliveryStatus.cancelled } as any);
      expect(mockPrisma.delivery.update).toHaveBeenCalled();
      expect(result.status).toBe(DeliveryStatus.cancelled);
    });
  });
});
