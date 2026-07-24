import { Injectable } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface AlertsQuery {
  page?: number;
  limit?: number;
  types?: NotificationType[];
  priorities?: NotificationPriority[];
  resolved?: boolean;
  deliveryId?: string;
  period?: 'today' | '7d' | '30d' | 'all';
}

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, query: AlertsQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: any = { companyId };

    if (query.types && query.types.length > 0) {
      where.type = { in: query.types };
    } else {
      where.type = { not: NotificationType.delivery_status };
    }

    if (query.priorities && query.priorities.length > 0) {
      where.priority = { in: query.priorities };
    }

    if (query.resolved !== undefined) {
      where.resolved = query.resolved;
    }

    if (query.deliveryId) {
      where.deliveryId = query.deliveryId;
    }

    if (query.period && query.period !== 'all') {
      const now = new Date();
      let since: Date;
      switch (query.period) {
        case 'today':
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case '7d':
          since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          since = new Date(0);
      }
      where.createdAt = { gte: since };
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          delivery: {
            select: { id: true, title: true, status: true, deliveryAddress: true },
          },
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
          resolvedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async resolve(companyId: string, id: string, userId: string, comment?: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, companyId },
    });
    if (!notification) throw new Error('Notification not found');

    return this.prisma.notification.update({
      where: { id },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedById: userId,
        resolutionComment: comment ?? null,
      },
    });
  }

  async stats(companyId: string, period?: string) {
    const where: any = { companyId, resolved: false, type: { not: NotificationType.delivery_status } };

    if (period && period !== 'all') {
      const now = new Date();
      let since: Date;
      switch (period) {
        case 'today':
          since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case '7d':
          since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          since = new Date(0);
      }
      where.createdAt = { gte: since };
    }

    const [total, byPriority, byType] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.groupBy({
        by: ['priority'],
        where,
        _count: true,
      }),
      this.prisma.notification.groupBy({
        by: ['type'],
        where,
        _count: true,
      }),
    ]);

    const prevWhere = { ...where, createdAt: undefined };
    if (period === '7d') {
      prevWhere.createdAt = {
        lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      };
    } else if (period === '30d') {
      prevWhere.createdAt = {
        lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      };
    }
    const prevTotal = prevWhere.createdAt
      ? await this.prisma.notification.count({ where: prevWhere })
      : null;

    return { total, byPriority, byType, prevTotal };
  }
}
