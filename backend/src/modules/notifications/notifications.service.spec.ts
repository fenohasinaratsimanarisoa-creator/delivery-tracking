import { NotificationPriority, NotificationType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
};

const emit = jest.fn();
const to = jest.fn(() => ({ emit }));
const mockGateway = {
  server: { to },
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(
      mockPrisma as unknown as PrismaService,
      mockGateway as unknown as NotificationsGateway,
    );
  });

  it('lists notifications by company and optional user', async () => {
    mockPrisma.notification.findMany.mockResolvedValueOnce([{ id: 'notif-1' }]);

    await expect(service.findAll('company-1', 'user-1', 10)).resolves.toEqual([{ id: 'notif-1' }]);
    expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', OR: [{ userId: 'user-1' }, { userId: null }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  });

  it('marks one notification as read inside the company scope', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(service.markRead('notif-1', 'company-1')).resolves.toEqual({
      count: 1,
    });
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'notif-1', companyId: 'company-1' },
      data: { readAt: expect.any(Date) },
    });
  });

  it('marks all unread user notifications as read', async () => {
    mockPrisma.notification.updateMany.mockResolvedValueOnce({ count: 3 });

    await service.markAllRead('company-1', 'user-1');
    expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', readAt: null, OR: [{ userId: 'user-1' }, { userId: null }] },
      data: { readAt: expect.any(Date) },
    });
  });

  it('returns unread count in a stable response shape', async () => {
    mockPrisma.notification.count.mockResolvedValueOnce(7);

    await expect(service.countUnread('company-1')).resolves.toEqual({ count: 7 });
  });

  describe('create', () => {
    const baseNotification = {
      id: 'notif-1',
      title: 'Delivery assigned',
      message: 'Delivery #1 assigned',
    };

    it('persists notifications and does not emit medium priority messages immediately', async () => {
      mockPrisma.notification.create.mockResolvedValueOnce(baseNotification);

      await expect(
        service.create('company-1', {
          type: NotificationType.delivery_status,
          priority: NotificationPriority.medium,
          title: 'Delivery assigned',
          message: 'Delivery #1 assigned',
        }),
      ).resolves.toEqual(baseNotification);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          companyId: 'company-1',
          type: NotificationType.delivery_status,
          priority: NotificationPriority.medium,
          title: 'Delivery assigned',
          message: 'Delivery #1 assigned',
          link: undefined,
          userId: undefined,
          deliveryId: undefined,
          digestOnly: false,
        },
      });
      expect(to).not.toHaveBeenCalled();
    });

    it('emits high priority notifications to company and targeted user rooms', async () => {
      mockPrisma.notification.create.mockResolvedValueOnce(baseNotification);

      await service.create('company-1', {
        type: NotificationType.system,
        priority: NotificationPriority.high,
        title: 'System alert',
        message: 'Action required',
        userId: 'user-1',
      });

      expect(to).toHaveBeenNthCalledWith(1, 'company:company-1');
      expect(to).toHaveBeenNthCalledWith(2, 'user:user-1');
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenCalledWith('notification', baseNotification);
    });

    it('does not emit digest-only notifications even when critical', async () => {
      mockPrisma.notification.create.mockResolvedValueOnce(baseNotification);

      await service.create('company-1', {
        type: NotificationType.system,
        priority: NotificationPriority.critical,
        title: 'Digest alert',
        message: 'Batch later',
        digestOnly: true,
      });

      expect(to).not.toHaveBeenCalled();
    });
  });

  it('groups digest notifications by priority', async () => {
    const notifications = [
      { id: 'n1', priority: NotificationPriority.critical },
      { id: 'n2', priority: NotificationPriority.high },
      { id: 'n3', priority: NotificationPriority.medium },
      { id: 'n4', priority: NotificationPriority.low },
    ];
    mockPrisma.notification.findMany.mockResolvedValueOnce(notifications);

    await expect(
      service.getDigestNotifications('company-1', new Date('2026-07-21T00:00:00.000Z'), 'user-1'),
    ).resolves.toEqual({
      critical: [notifications[0]],
      high: [notifications[1]],
      medium: [notifications[2]],
      low: [notifications[3]],
      total: 4,
    });
  });
});
