import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

class MockPrismaClientKnownRequestError extends Error {
  code: string;
  meta: any;
  constructor(message: string, code: string, meta?: any) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
    this.meta = meta;
  }
}
import * as ExcelJS from 'exceljs';
import { GeocodingService } from '../geocoding/geocoding.service';
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

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
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
        {
          provide: DataUpdateBus,
          useValue: { emit: jest.fn(), emitUpdate: jest.fn(), on: jest.fn() },
        },
        { provide: GeocodingService, useValue: { search: jest.fn().mockResolvedValue([]) } },
        { provide: getQueueToken('fuel-analysis'), useValue: mockQueue },
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
      id: 'del-1',
      companyId: 'comp-1',
      title: 'Test Delivery',
      status: DeliveryStatus.pending,
      deletedAt: null,
      vehicle: null,
      driver: null,
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
        expect.objectContaining({
          where: { id: 'del-1', companyId: 'comp-1', deletedAt: null, clientId: 'client-123' },
        }),
      );
    });

    it('should filter by assignedDriverId for driver role', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(baseDelivery);
      await service.findOne('comp-1', 'del-1', 'driver', 'driver-123');
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'del-1',
            companyId: 'comp-1',
            deletedAt: null,
            assignedDriverId: 'driver-123',
          },
        }),
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
        id: 'del-1',
        companyId: 'comp-1',
        title: 'Test',
        status: DeliveryStatus.pending,
        deletedAt: null,
        vehicle: null,
        driver: null,
        deliveryLat: null,
        deliveryLng: null,
        assignedDriverId: null,
        clientId: null,
      });
      await expect(
        service.update('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid status transition pending -> in_progress', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-2',
        companyId: 'comp-1',
        title: 'Test',
        status: DeliveryStatus.pending,
        deletedAt: null,
        vehicle: null,
        driver: null,
        deliveryLat: null,
        deliveryLng: null,
        assignedDriverId: null,
        clientId: null,
      });
      await expect(
        service.update('comp-1', 'del-2', { status: DeliveryStatus.in_progress } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow valid transition pending -> assigned', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-3',
        companyId: 'comp-1',
        title: 'Test',
        status: DeliveryStatus.pending,
        deletedAt: null,
        vehicle: null,
        driver: null,
        deliveryLat: null,
        deliveryLng: null,
        assignedDriverId: null,
        clientId: null,
      });
      mockPrisma.delivery.update.mockResolvedValueOnce({
        id: 'del-3',
        status: DeliveryStatus.assigned,
      });
      const result = await service.update('comp-1', 'del-3', {
        status: DeliveryStatus.assigned,
      } as any);
      expect(mockPrisma.delivery.update).toHaveBeenCalled();
      expect(result.status).toBe(DeliveryStatus.assigned);
    });

    it('should allow valid transition assigned -> cancelled', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-4',
        companyId: 'comp-1',
        title: 'Test',
        status: DeliveryStatus.assigned,
        deletedAt: null,
        vehicle: null,
        driver: null,
        deliveryLat: null,
        deliveryLng: null,
        assignedDriverId: null,
        clientId: null,
      });
      mockPrisma.delivery.update.mockResolvedValueOnce({
        id: 'del-4',
        status: DeliveryStatus.cancelled,
      });
      const result = await service.update('comp-1', 'del-4', {
        status: DeliveryStatus.cancelled,
      } as any);
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
      mockPrisma.delivery.create.mockResolvedValue({});

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Adresse', 'Téléphone', 'Montant', 'Prix', 'Produits commandés'],
        ['CMD-001', 'Ivato', 'Lot 45', '0341234567', '50 000Ar', '45 000Ar', 'Cartons A4'],
        [
          'CMD-002',
          'Analakely',
          'Rue 12',
          '0327654321',
          '54\u202F000Ar',
          '50\u202F000Ar',
          'Enveloppes',
        ],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Entrepôt principal');

      expect(result.created).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
      expect(mockPrisma.delivery.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPrisma.delivery.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'CMD-001',
            externalOrderRef: 'CMD-001',
            deliveryAddress: 'Ivato',
            amount: 50000,
            articlePrice: 45000,
          }),
        }),
      );
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
        .mockResolvedValueOnce(null) // row 2: not found in DB
        .mockResolvedValueOnce(null); // row 3: not found in DB either (same file, not yet inserted)
      mockPrisma.delivery.create
        .mockResolvedValueOnce({}) // row 2: create succeeds
        .mockRejectedValueOnce(
          new MockPrismaClientKnownRequestError(
            // row 3: P2002 duplicate
            'Unique constraint failed',
            'P2002',
            { target: ['companyId', 'externalOrderRef'] },
          ),
        );

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
      mockPrisma.delivery.create.mockResolvedValue({});

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu', 'Observation'],
        ['CMD-006', 'Ivato', 'Matinée 8h-12h'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.created).toBe(1);
      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ notes: 'Observation: Matinée 8h-12h' }),
        }),
      );
    });

    it('should upsert existing deliveries and not regress status', async () => {
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce({ id: 'existing-1', status: 'delivered' })
        .mockResolvedValueOnce(null);
      mockPrisma.delivery.update.mockResolvedValue({});
      mockPrisma.delivery.create.mockResolvedValue({});

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
      mockPrisma.delivery.create.mockResolvedValue({});

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu'],
        ['CMD-SCOPE', 'Ivato'],
      ]);

      const result1 = await service.importExcel('comp-1', buffer, 'Dépôt');
      const result2 = await service.importExcel('comp-2', buffer, 'Dépôt');

      expect(result1.created).toBe(1);
      expect(result2.created).toBe(1);
      expect(mockPrisma.delivery.findFirst).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { companyId: 'comp-1', externalOrderRef: 'CMD-SCOPE', deletedAt: null },
        }),
      );
      expect(mockPrisma.delivery.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { companyId: 'comp-2', externalOrderRef: 'CMD-SCOPE', deletedAt: null },
        }),
      );
    });

    it('should catch P2002 from race condition in try/catch safety net', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValue(null); // pre-check misses (race condition)
      mockPrisma.delivery.create.mockRejectedValueOnce(
        new MockPrismaClientKnownRequestError('Unique constraint failed', 'P2002', {
          target: ['companyId', 'externalOrderRef'],
        }),
      );

      const buffer = await createXlsxBuffer([
        ['N° Commande', 'Lieu'],
        ['CMD-RACE', 'Ivato'],
      ]);

      const result = await service.importExcel('comp-1', buffer, 'Dépôt');

      expect(result.created).toBe(0);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('duplicate');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('BUG A — driver assignment', () => {
    it('should assign driverId and assignedDriverId when driver exists with userId', async () => {
      const driver = { id: 'driver-1', userId: 'user-123', companyId: 'comp-1', deletedAt: null };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-new',
        title: 'Test',
        driverId: 'driver-1',
        assignedDriverId: 'user-123',
        status: 'in_progress',
        companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Test',
        pickupAddress: 'Pickup',
        deliveryAddress: 'Delivery',
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
          title: 'Test',
          pickupAddress: 'Pickup',
          deliveryAddress: 'Delivery',
          driverId: 'nonexistent-driver',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when driverId belongs to another company', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('comp-1', {
          title: 'Test',
          pickupAddress: 'Pickup',
          deliveryAddress: 'Delivery',
          driverId: 'driver-other-company',
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should assign driver via update', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({
        id: 'del-upd',
        companyId: 'comp-1',
        title: 'Test',
        status: 'in_progress',
        deletedAt: null,
        vehicle: null,
        driver: null,
        deliveryLat: null,
        deliveryLng: null,
        assignedDriverId: null,
        clientId: null,
      });
      const driver = { id: 'driver-2', userId: 'user-456', companyId: 'comp-1', deletedAt: null };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);
      const updatedDelivery = {
        id: 'del-upd',
        title: 'Test',
        driverId: 'driver-2',
        assignedDriverId: 'user-456',
        status: 'in_progress',
        companyId: 'comp-1',
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

  describe('default status pending', () => {
    it('should default to pending when no status provided in create', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-dflt',
        title: 'Default',
        status: DeliveryStatus.pending,
        companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Default',
        pickupAddress: 'Pickup',
        deliveryAddress: 'Delivery',
      } as any);

      expect(mockPrisma.delivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: DeliveryStatus.pending }),
        }),
      );
      expect(result.status).toBe(DeliveryStatus.pending);
    });

    it('should respect explicit status when provided in create', async () => {
      mockPrisma.driver.findFirst.mockResolvedValue(null);
      mockPrisma.delivery.create.mockResolvedValueOnce({
        id: 'del-exp',
        title: 'Explicit',
        status: DeliveryStatus.assigned,
        companyId: 'comp-1',
      });

      const result = await service.create('comp-1', {
        title: 'Explicit',
        pickupAddress: 'Pickup',
        deliveryAddress: 'Delivery',
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
      mockPrisma.delivery.findMany.mockResolvedValue([
        { id: 'del-ok', status: 'pending', companyId: 'comp-1', deletedAt: null },
        { id: 'del-in-progress', status: 'in_progress', companyId: 'comp-1', deletedAt: null },
      ]);
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-ok', 'del-not-found', 'del-in-progress'],
        action: 'delete',
      });

      expect(result.succeeded).toEqual(['del-ok']);
      expect(result.failed).toHaveLength(2);
      expect(result.failed[0].reason).toContain('not found');
      expect(result.failed[1].reason).toContain('in progress');
    });

    it('should update status respecting transition matrix', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([
        { id: 'del-a', status: 'pending', companyId: 'comp-1', deletedAt: null },
        { id: 'del-b', status: 'delivered', companyId: 'comp-1', deletedAt: null },
      ]);
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
      mockPrisma.delivery.findMany.mockResolvedValue([
        { id: 'del-d1', status: 'pending', companyId: 'comp-1', deletedAt: null },
        { id: 'del-d2', status: 'pending', companyId: 'comp-1', deletedAt: null },
      ]);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({
        id: 'drv-1',
        userId: 'user-99',
        companyId: 'comp-1',
      });
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-d1', 'del-d2'],
        action: 'assignDriver',
        driverId: 'drv-1',
      });

      expect(result.succeeded).toEqual(['del-d1']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('not found');
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ driverId: 'drv-1', assignedDriverId: 'user-99' }),
        }),
      );
    });
  });

  describe('realtime fuel report recompute (delivered)', () => {
    const inProgressDelivery = {
      id: 'del-1',
      companyId: 'comp-1',
      title: 'Test',
      status: DeliveryStatus.in_progress,
      deletedAt: null,
      vehicle: null,
      driver: null,
      deliveryLat: null,
      deliveryLng: null,
      deliveryAddress: 'Ivato',
      assignedDriverId: 'user-1',
      clientId: null,
      driverId: 'driver-1',
    };
    const expectJobAdded = (driverId: string, status?: DeliveryStatus) => {
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recompute-driver-report',
        expect.objectContaining({
          companyId: 'comp-1',
          driverId,
          date: expect.any(String),
          ...(status ? { status } : {}),
        }),
      );
    };
    const expectNoJobAdded = () => expect(mockQueue.add).not.toHaveBeenCalled();

    it('updateDriverStatus → delivered enqueues a recompute job with the driverId', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({
        ...inProgressDelivery,
        status: 'delivered',
      });

      await service.updateDriverStatus('comp-1', 'del-1', 'user-1', {
        status: DeliveryStatus.delivered,
      } as any);

      expectJobAdded('driver-1');
    });

    it('updateDriverStatus → failed enqueues a recompute job with the driverId and status', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({ ...inProgressDelivery, status: 'failed' });

      await service.updateDriverStatus('comp-1', 'del-1', 'user-1', {
        status: DeliveryStatus.failed,
      } as any);

      expectJobAdded('driver-1', DeliveryStatus.failed);
    });

    it('updateDriverStatus → delivered with no driver does NOT enqueue a job', async () => {
      const noDriver = { ...inProgressDelivery, driverId: null };
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(noDriver);
      mockPrisma.delivery.update.mockResolvedValueOnce({ ...noDriver, status: 'delivered' });

      await service.updateDriverStatus('comp-1', 'del-1', 'user-1', {
        status: DeliveryStatus.delivered,
      } as any);

      expectNoJobAdded();
    });

    it('updateStatus → delivered enqueues a recompute job with the driverId', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({
        ...inProgressDelivery,
        status: 'delivered',
      });

      await service.updateStatus('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any);

      expectJobAdded('driver-1', DeliveryStatus.delivered);
    });

    it('updateStatus → failed enqueues a recompute job with the driverId and status', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({ ...inProgressDelivery, status: 'failed' });

      await service.updateStatus('comp-1', 'del-1', { status: DeliveryStatus.failed } as any);

      expectJobAdded('driver-1', DeliveryStatus.failed);
    });

    it('update → delivered enqueues a recompute job using the delivery driverId', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({
        ...inProgressDelivery,
        status: 'delivered',
      });

      await service.update('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any);

      expectJobAdded('driver-1', DeliveryStatus.delivered);
    });

    it('update → failed enqueues a recompute job using the delivery driverId', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({ ...inProgressDelivery, status: 'failed' });

      await service.update('comp-1', 'del-1', { status: DeliveryStatus.failed } as any);

      expectJobAdded('driver-1', DeliveryStatus.failed);
    });

    it('update → delivered enqueues a recompute job using the new driverId when reassigning simultaneously', async () => {
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({
        id: 'driver-2',
        userId: 'user-2',
        companyId: 'comp-1',
      });
      mockPrisma.delivery.update.mockResolvedValueOnce({
        ...inProgressDelivery,
        driverId: 'driver-2',
        status: 'delivered',
      });

      await service.update('comp-1', 'del-1', {
        status: DeliveryStatus.delivered,
        driverId: 'driver-2',
      } as any);

      expectJobAdded('driver-2');
    });

    it('update → assigned does NOT enqueue a recompute job', async () => {
      const pendingDelivery = { ...inProgressDelivery, status: DeliveryStatus.pending };
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(pendingDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({ ...pendingDelivery, status: 'assigned' });

      await service.update('comp-1', 'del-1', { status: DeliveryStatus.assigned } as any);

      expectNoJobAdded();
    });

    it('bulkAction updateStatus → delivered enqueues a recompute job per affected delivery', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([
        {
          id: 'del-a',
          status: 'in_progress',
          companyId: 'comp-1',
          deletedAt: null,
          driverId: 'driver-1',
        },
        {
          id: 'del-b',
          status: 'in_progress',
          companyId: 'comp-1',
          deletedAt: null,
          driverId: 'driver-2',
        },
      ]);
      mockPrisma.delivery.update.mockResolvedValue({});

      const result = await service.bulkAction('comp-1', {
        ids: ['del-a', 'del-b'],
        action: 'updateStatus',
        status: 'delivered',
      });

      expect(result.succeeded).toEqual(['del-a', 'del-b']);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recompute-driver-report',
        expect.objectContaining({ companyId: 'comp-1', driverId: 'driver-1', status: 'delivered' }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'recompute-driver-report',
        expect.objectContaining({ companyId: 'comp-1', driverId: 'driver-2', status: 'delivered' }),
      );
    });

    it('bulkAction updateStatus → failed enqueues a recompute job per affected delivery', async () => {
      mockPrisma.delivery.findMany.mockResolvedValue([
        {
          id: 'del-a',
          status: 'in_progress',
          companyId: 'comp-1',
          deletedAt: null,
          driverId: 'driver-1',
        },
      ]);
      mockPrisma.delivery.update.mockResolvedValue({});

      await service.bulkAction('comp-1', {
        ids: ['del-a'],
        action: 'updateStatus',
        status: 'failed',
      });

      expectJobAdded('driver-1', DeliveryStatus.failed);
    });

    it('still succeeds when the queue is not configured (@Optional) — job simply not dispatched', async () => {
      // Reconstruit le service SANS le provider de queue pour simuler un environnement
      // sans Redis/BullMQ : la complétion de livraison ne doit pas planter.
      const moduleNoQueue = await Test.createTestingModule({
        providers: [
          DeliveriesService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: NotificationsService, useValue: mockNotifications },
          { provide: WebhooksService, useValue: mockWebhooks },
          { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('false') } },
          {
            provide: DataUpdateBus,
            useValue: { emit: jest.fn(), emitUpdate: jest.fn(), on: jest.fn() },
          },
          { provide: GeocodingService, useValue: { search: jest.fn().mockResolvedValue([]) } },
        ],
      }).compile();
      const svc = moduleNoQueue.get<DeliveriesService>(DeliveriesService);
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update.mockResolvedValueOnce({
        ...inProgressDelivery,
        status: 'delivered',
      });

      await expect(
        svc.updateStatus('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any),
      ).resolves.toBeDefined();
    });
  });

  describe('verrou optimiste — updateStatus concurrents', () => {
    const inProgressDelivery = {
      id: 'del-1',
      companyId: 'comp-1',
      title: 'Test',
      status: DeliveryStatus.in_progress,
      deletedAt: null,
      vehicle: null,
      driver: null,
      deliveryLat: null,
      deliveryLng: null,
      deliveryAddress: 'Ivato',
      assignedDriverId: 'user-1',
      clientId: null,
      driverId: 'driver-1',
    };

    it("deux updateStatus() concurrents sur la même livraison : un seul réussit, notifications/webhooks ne partent qu'une fois", async () => {
      // Les DEUX appels lisent d'abord la livraison (statut in_progress), puis
      // le premier update réussit ; le second, déclenché sur le même statut,
      // ne matche plus aucune ligne (verrou optimiste) → P2025 en base.
      mockPrisma.delivery.findFirst
        .mockResolvedValueOnce(inProgressDelivery)
        .mockResolvedValueOnce(inProgressDelivery);
      mockPrisma.delivery.update
        .mockResolvedValueOnce({ ...inProgressDelivery, status: 'delivered' })
        .mockRejectedValueOnce(
          new MockPrismaClientKnownRequestError('Record to update not found', 'P2025'),
        );

      const [r1, r2] = await Promise.allSettled([
        service.updateStatus('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any),
        service.updateStatus('comp-1', 'del-1', { status: DeliveryStatus.delivered } as any),
      ]);

      // Un seul appel réussit...
      const fulfilled = [r1, r2].filter((r) => r.status === 'fulfilled');
      const rejected = [r1, r2].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      // ...l'autre échoue proprement en 400 (et NON en 500) avec le message explicite.
      expect(rejected).toHaveLength(1);
      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toBe('Ce statut a déjà été modifié entretemps, actualisez la page');

      // Le verrou optimiste passe bien le statut attendu dans le WHERE.
      expect(mockPrisma.delivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: DeliveryStatus.in_progress }),
        }),
      );

      // Les effets de bord ne partent qu'UNE fois (livraison "delivered" =
      // notification + webhook status_changed + webhook delivered + job fuel).
      expect(mockNotifications.create).toHaveBeenCalledTimes(1);
      expect(mockWebhooks.dispatch).toHaveBeenCalledTimes(2);
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
