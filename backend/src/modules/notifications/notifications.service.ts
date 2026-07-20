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
        ...(userId ? { userId } : {}),
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
        ...(userId ? { userId } : {}),
      },
      data: { readAt: new Date() },
    });
  }

  async countUnread(companyId: string, userId?: string) {
    return this.prisma.notification.count({
      where: {
        companyId,
        readAt: null,
        ...(userId ? { userId } : {}),
      },
    });
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
    },
  ) {
    const notification = await this.prisma.notification.create({
      data: { ...data, companyId },
    });

    // Emit to company room and optionally to specific user
    const room = `company:${companyId}`;
    this.gateway.server.to(room).emit('notification', notification);
    if (data.userId) {
      this.gateway.server
        .to(`user:${data.userId}`)
        .emit('notification', notification);
    }

    return notification;
  }
}
