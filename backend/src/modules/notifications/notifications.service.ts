import { Injectable } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
  ) {}

  async findAll(companyId: string, userId?: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: {
        companyId,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async markRead(id: string, companyId: string) {
    return this.prisma.notification.updateMany({
      where: { id, companyId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(companyId: string, userId?: string) {
    return this.prisma.notification.updateMany({
      where: {
        companyId,
        readAt: null,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
      data: { readAt: new Date() },
    });
  }

  async remove(id: string, companyId: string) {
    return this.prisma.notification.deleteMany({
      where: { id, companyId },
    });
  }

  async removeAll(companyId: string, userId?: string) {
    return this.prisma.notification.deleteMany({
      where: {
        companyId,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
    });
  }

  async countUnread(companyId: string, userId?: string) {
    const count = await this.prisma.notification.count({
      where: {
        companyId,
        readAt: null,
        ...(userId ? { OR: [{ userId }, { userId: null }] } : {}),
      },
    });
    return { count };
  }

  async create(
    companyId: string,
    data: {
      type: NotificationType;
      priority: NotificationPriority;
      title: string;
      message: string;
      link?: string;
      userId?: string;
      deliveryId?: string;
      digestOnly?: boolean;
    },
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        companyId,
        type: data.type,
        priority: data.priority,
        title: data.title,
        message: data.message,
        link: data.link,
        userId: data.userId,
        deliveryId: data.deliveryId,
        digestOnly: data.digestOnly ?? false,
      },
    });

    // Critical/high priority notifications are sent immediately unless digestOnly is set
    const shouldSendImmediately =
      !data.digestOnly && (data.priority === 'critical' || data.priority === 'high');

    if (shouldSendImmediately) {
      const room = `company:${companyId}`;
      this.gateway.server.to(room).emit('notification', notification);
      if (data.userId) {
        this.gateway.server.to(`user:${data.userId}`).emit('notification', notification);
      }
    }

    return notification;
  }

  async getDigestNotifications(companyId: string, since: Date, userId?: string) {
    const where: any = {
      companyId,
      createdAt: { gte: since },
    };
    if (userId) where.userId = userId;

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Group by priority
    return {
      critical: notifications.filter((n) => n.priority === 'critical'),
      high: notifications.filter((n) => n.priority === 'high'),
      medium: notifications.filter((n) => n.priority === 'medium'),
      low: notifications.filter((n) => n.priority === 'low'),
      total: notifications.length,
    };
  }
}
