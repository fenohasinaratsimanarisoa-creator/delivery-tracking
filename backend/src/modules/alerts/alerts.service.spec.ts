import { NotFoundException } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AlertsService } from './alerts.service';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    groupBy: jest.fn(),
  },
};

describe('AlertsService', () => {
  let service: AlertsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AlertsService(mockPrisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns paginated alerts for a company', async () => {
      const notifications = [{ id: 'notif-1', companyId: 'company-1' }];
      mockPrisma.notification.findMany.mockResolvedValueOnce(notifications);
      mockPrisma.notification.count.mockResolvedValueOnce(5);

      const result = await service.findAll('company-1', { page: 1, limit: 10 });

      expect(result.data).toEqual(notifications);
      expect(result.meta).toEqual({ total: 5, page: 1, limit: 10, totalPages: 1 });
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }),
          skip: 0,
          take: 10,
        }),
      );
    });

    it('filters by types', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);
      mockPrisma.notification.count.mockResolvedValueOnce(0);

      await service.findAll('company-1', { types: [NotificationType.system] });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: { in: [NotificationType.system] },
          }),
        }),
      );
    });

    it('filters by resolved status', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);
      mockPrisma.notification.count.mockResolvedValueOnce(0);

      await service.findAll('company-1', { resolved: false });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ resolved: false }),
        }),
      );
    });

    it('scopes strictly to a driver: own userId OR deliveries assigned to them', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([]);
      mockPrisma.notification.count.mockResolvedValueOnce(0);

      await service.findAll('company-1', { page: 1, limit: 20 }, 'driver-1');

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'company-1',
            OR: [{ userId: 'driver-1' }, { delivery: { assignedDriverId: 'driver-1' } }],
          }),
        }),
      );
      // Le scope driver N'EST PAS appliqué pour admin/dispatcher (pas de driverUserId)
      mockPrisma.notification.findMany.mockClear();
      mockPrisma.notification.count.mockClear();
      await service.findAll('company-1', { page: 1, limit: 20 });
      const call = mockPrisma.notification.findMany.mock.calls[0][0] as { where: any };
      expect(call.where.OR).toBeUndefined();
    });
  });

  describe('resolve', () => {
    it('resolves a notification with comment', async () => {
      const notification = { id: 'notif-1', companyId: 'company-1' };
      mockPrisma.notification.findFirst.mockResolvedValueOnce(notification);
      mockPrisma.notification.update.mockResolvedValueOnce({
        ...notification,
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: 'user-1',
        resolutionComment: 'Fixed',
      });

      const result = await service.resolve('company-1', 'notif-1', 'user-1', 'Fixed');

      expect(result.resolved).toBe(true);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: expect.objectContaining({
          resolved: true,
          resolvedById: 'user-1',
          resolutionComment: 'Fixed',
        }),
      });
    });

    it('throws when notification is not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValueOnce(null);

      await expect(service.resolve('company-1', 'missing', 'user-1')).rejects.toThrow(
        'Notification not found',
      );
    });
  });

  describe('stats', () => {
    it('returns notification statistics', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(10);
      mockPrisma.notification.groupBy
        .mockResolvedValueOnce([
          { priority: 'high', _count: 5 },
          { priority: 'low', _count: 5 },
        ])
        .mockResolvedValueOnce([{ type: 'alert', _count: 10 }]);

      const result = await service.stats('company-1');

      expect(result.total).toBe(10);
      expect(result.byPriority).toHaveLength(2);
      expect(result.byType).toHaveLength(1);
    });
  });
});
