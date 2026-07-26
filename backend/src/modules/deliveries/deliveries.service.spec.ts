import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import * as ExcelJS from 'exceljs';
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
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      createMany: jest.fn(),
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

  describe('importExcel', () => {
    async function createXlsxBuffer(rows: string[][]): Promise<Buffer> {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      rows.forEach((r) => ws.addRow(r));
      const data = await wb.xlsx.writeBuffer();
      return data as unknown as Buffer;
    }

    it('should parse valid rows and create deliveries', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.createMany.mockResolvedValue({ count: 2 });

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Adresse', 'Téléphone', 'Montant', 'Prix', 'Produits commandés'],
        ['CMD-001', 'Ivato', 'Lot 45', '0341234567', '50 000Ar', '45 000Ar', 'Cartons A4'],
        ['CMD-002', 'Analakely', 'Rue 12', '0327654321', '54\u202F000Ar', '50\u202F000Ar', 'Enveloppes'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Entrepôt principal');

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPrisma.delivery.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ title: 'CMD-001', externalOrderRef: 'CMD-001', deliveryAddress: 'Ivato', amount: 50000, articlePrice: 45000 }),
          expect.objectContaining({ title: 'CMD-002', externalOrderRef: 'CMD-002', deliveryAddress: 'Analakely', amount: 54000, articlePrice: 50000 }),
        ]),
      });
    });

    it('should skip rows with missing N° Commande (error)', async () => {
      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Montant'],
        ['', 'Ivato', '50000'],
        ['CMD-003', 'Analakely', '30000'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toContain('N° Commande manquant');
      expect(result.created).toBe(1);
    });

    it('should skip rows with missing Lieu (error)', async () => {
      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Montant'],
        ['CMD-004', '', '50000'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].reason).toContain('Lieu');
      expect(result.created).toBe(0);
    });

    it('should skip duplicate external order refs with reason duplicate', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'existing', status: 'in_progress' });
      mockPrisma.delivery.createMany.mockResolvedValue({ count: 1 });

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu'],
        ['CMD-005', 'Ivato'],
        ['CMD-005', 'Analakely'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.created).toBe(1);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].orderRef).toBe('CMD-005');
      expect(result.skipped[0].reason).toBe('duplicate');
    });

    it('should store Observation in notes', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.createMany.mockResolvedValue({ count: 1 });

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Observation'],
        ['CMD-006', 'Ivato', 'Matinée 8h-12h'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.created).toBe(1);
      expect(mockPrisma.delivery.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ notes: 'Observation: Matinée 8h-12h' }),
        ]),
      });
    });

    it('should upsert existing deliveries and not regress status', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce({ id: 'existing-1', status: 'delivered' })
        .mockResolvedValueOnce(null);
      mockPrisma.delivery.update.mockResolvedValue({});
      mockPrisma.delivery.createMany.mockResolvedValue({ count: 1 });

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Montant'],
        ['CMD-EXIST', 'Ivato', '10000'],
        ['CMD-NEW', 'Analakely', '20000'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt', 'upsert');

      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-1' },
          data: expect.objectContaining({ deliveryAddress: 'Ivato', amount: 10000 }),
        }),
      );
      // Status should NOT be in updateData for delivered — it stays as-is
      expect(mockPrisma.delivery.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: expect.anything() }) }),
      );
    });

    it('should scope duplicate check by companyId', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce(null) // comp-1: CMD-SCOPE not found → create
        .mockResolvedValueOnce(null); // comp-2: CMD-SCOPE not found → create
      mockPrisma.delivery.createMany.mockResolvedValue({ count: 2 });

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu'],
        ['CMD-SCOPE', 'Ivato'],
      ]);

      const result1 = await service.importExcel('comp-1', buffer, 'Dépôt');
      const result2 = await service.importExcel('comp-2', buffer, 'Dépôt');

      expect(result1.created).toBe(1);
      expect(result2.created).toBe(1);
      expect(mockPrisma.delivery.findFirst).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ where: { companyId: 'comp-1', externalOrderRef: 'CMD-SCOPE', deletedAt: null } }),
      );
      expect(mockPrisma.delivery.findFirst).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ where: { companyId: 'comp-2', externalOrderRef: 'CMD-SCOPE', deletedAt: null } }),
      );
    });
  });

  describe('BUG A — driver assignment', () => {
    it('should assign driverId and assignedDriverId when driver exists with userId', async () => {
      const driver = { id: 'driver-1', userId: 'user-123', companyId: 'comp-1', deletedAt: null };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-new', title: 'Test', driverId: 'driver-1', assignedDriverId: 'user-123',
        status: 'in_progress', companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Test', pickupAddress: 'Pickup', deliveryAddress: 'Delivery',
        driverId: 'driver-1',
      } as any);

      expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({
        where: { id: 'driver-1', companyId: 'comp-1', deletedAt: null },
        select: { userId: true },
      });
      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverId: 'driver-1', assignedDriverId: 'user-123' }),
        }),
      );
      expect(result.driverId).toBe('driver-1');
      expect(result.assignedDriverId).toBe('user-123');
    });

    it('should throw NotFoundException when driverId does not exist in company', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('comp-1', {
          title: 'Test', pickupAddress: 'Pickup', deliveryAddress: 'Delivery',
          driverId: 'nonexistent-driver',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when driverId belongs to another company', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('comp-1', {
          title: 'Test', pickupAddress: 'Pickup', deliveryAddress: 'Delivery',
          driverId: 'driver-other-company',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should assign driver via update', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-upd', companyId: 'comp-1', title: 'Test',
        status: 'in_progress', deletedAt: null,
        vehicle: null, driver: null, deliveryLat: null, deliveryLng: null,
        assignedDriverId: null, clientId: null,
      });
      const driver = { id: 'driver-2', userId: 'user-456', companyId: 'comp-1', deletedAt: null };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);
      const updatedDelivery = {
        id: 'del-upd', title: 'Test', driverId: 'driver-2', assignedDriverId: 'user-456',
        status: 'in_progress', companyId: 'comp-1',
      };
      mockPrisma.delivery.update.mockResolvedValueOnce(updatedDelivery);

      const result = await service.update('comp-1', 'del-upd', { driverId: 'driver-2' } as any);

      expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({
        where: { id: 'driver-2', companyId: 'comp-1', deletedAt: null },
        select: { userId: true },
      });
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverId: 'driver-2', assignedDriverId: 'user-456' }),
        }),
      );
      expect(result.driverId).toBe('driver-2');
      expect(result.assignedDriverId).toBe('user-456');
    });
  });

  describe('BUG B — default status in_progress', () => {
    it('should default to in_progress when no status provided in create', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-dflt', title: 'Default', status: DeliveryStatus.in_progress,
        companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Default', pickupAddress: 'Pickup', deliveryAddress: 'Delivery',
      } as any);

      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DeliveryStatus.in_progress }),
        }),
      );
      expect(result.status).toBe(DeliveryStatus.in_progress);
    });

    it('should respect explicit status when provided in create', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-exp', title: 'Explicit', status: DeliveryStatus.assigned,
        companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Explicit', pickupAddress: 'Pickup', deliveryAddress: 'Delivery',
        status: DeliveryStatus.assigned,
      } as any);

      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DeliveryStatus.assigned }),
        }),
      );
      expect(result.status).toBe(DeliveryStatus.assigned);
    });
  });

  describe('bulkAction', () => {
    it('should succeed on valid ids and fail on invalid', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce({ id: 'del-ok', status: 'pending', companyId: 'comp-1', deletedAt: null })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'del-in-progress', status: 'in_progress', companyId: 'comp-1', deletedAt: null });
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-ok', 'del-not-found', 'del-in-progress'],
        action: 'delete',
      });

      expect(result.succeeded).toEqual(['del-ok']);
      expect(result.failed).toHaveLength(2);
      expect(result.failed[0].reason).toContain('introuvable');
      expect(result.failed[1].reason).toContain('en cours');
    });

    it('should update status respecting transition matrix', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce({ id: 'del-a', status: 'pending', companyId: 'comp-1', deletedAt: null })
        .mockResolvedValueOnce({ id: 'del-b', status: 'delivered', companyId: 'comp-1', deletedAt: null });
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-a', 'del-b'],
        action: 'updateStatus',
        status: 'cancelled',
      });

      expect(result.succeeded).toEqual(['del-a']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('Transition');
    });

    it('should assign driver and set assignedDriverId', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce({ id: 'del-d1', status: 'pending', companyId: 'comp-1', deletedAt: null })
        .mockResolvedValueOnce({ id: 'del-d2', status: 'pending', companyId: 'comp-1', deletedAt: null });
      mockPrisma.driver.findFirst
        .mockResolvedValueOnce({ id: 'drv-1', userId: 'user-99', companyId: 'comp-1' })
        .mockResolvedValueOnce(null);
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-d1', 'del-d2'],
        action: 'assignDriver',
        driverId: 'drv-1',
      });

      expect(result.succeeded).toEqual(['del-d1']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('introuvable');
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ driverId: 'drv-1', assignedDriverId: 'user-99' }) }),
      );
    });
  });
});
