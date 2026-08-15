import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsGateway } from './notifications.gateway';
import { EmailService } from '../email/email.service';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private gateway: NotificationsGateway,
    private emailService: EmailService,
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

  async markRead(id: string, companyId: string, userId?: string) {
    const where: any = { id, companyId };
    if (userId) {
      where.OR = [{ userId }, { userId: null }];
    }
    const result = await this.prisma.notification.updateMany({
      where,
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const existing = await this.prisma.notification.findUnique({
        where: { id },
        select: { id: true },
      });
      if (existing) throw new ForbiddenException('Notification belongs to another user');
      throw new NotFoundException('Notification not found');
    }
    return result;
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

  async remove(id: string, companyId: string, userId?: string) {
    const where: any = { id, companyId };
    if (userId) {
      where.OR = [{ userId }, { userId: null }];
    }
    const result = await this.prisma.notification.deleteMany({ where });
    if (result.count === 0) {
      const existing = await this.prisma.notification.findUnique({
        where: { id },
        select: { id: true },
      });
      if (existing) throw new ForbiddenException('Notification belongs to another user');
      throw new NotFoundException('Notification not found');
    }
    return result;
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

      // Email immédiat pour critical (et high avec fallback) si personne n'est connecté
      if (data.priority === 'critical') {
        this.sendCriticalEmail(companyId, notification, data).catch((err) =>
          this.logger.error(`Failed to send critical email: ${err.message}`),
        );
      }
    }

    return notification;
  }

  // Échappe le HTML des champs utilisateur (title/message/link) injectés dans l'email :
  // sans cela, un titre de livraison ou un message contenant du HTML (<script>, <img onerror>…)
  // était injecté tel quel dans le corps de l'email critique (XSS par contenu utilisateur).
  private escapeHtml(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private async sendCriticalEmail(companyId: string, notification: any, data: any) {
    const title = this.escapeHtml(notification.title);
    const message = this.escapeHtml(notification.message);
    const link = notification.link ? this.escapeHtml(notification.link) : null;
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111827">${title}</h2>
        <p style="color:#6b7280;line-height:1.5">${message}</p>
        ${link ? `<a href="${this.emailService['appUrl'] || 'http://localhost:5173'}${link}" style="display:inline-block;padding:12px 24px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">Voir les détails</a>` : ''}
      </div>`;

    const targetEmail = data.userId
      ? await this.prisma.user.findUnique({ where: { id: data.userId }, select: { email: true } })
      : null;

    if (targetEmail?.email) {
      await this.emailService.send(targetEmail.email, `[URGENT] ${notification.title}`, html);
    } else if (!data.userId) {
      const admins = await this.prisma.user.findMany({
        where: { companyId, role: { in: ['admin', 'dispatcher'] }, isActive: true },
        select: { email: true },
      });
      for (const admin of admins) {
        if (admin.email) {
          try {
            await this.emailService.send(admin.email, `[URGENT] ${notification.title}`, html);
          } catch {}
        }
      }
    }
  }

  @Cron('0 3 * * 0')
  async purgeOldReadNotifications() {
    this.logger.log('Purging read notifications older than 90 days...');
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.notification.deleteMany({
      where: { readAt: { lt: cutoff } },
    });
    this.logger.log(`Purged ${result.count} old read notifications`);
  }

  async getDigestNotifications(companyId: string, since: Date, userId?: string) {
    // Seules les notifications PAS encore délivrées en temps réel appartiennent au
    // digest : `digestOnly` (jamais poussées) OU priorité medium/low (jamais poussées
    // — create() ne pousse que critical/high). AVANT, les notifications critical/high
    // déjà poussées (websocket + email immédiat) étaient comptées DANS le digest ET
    // marquées digestSentAt → double signalement dans l'email récapitulatif.
    const where: any = {
      companyId,
      createdAt: { gte: since },
      digestSentAt: null,
      AND: [{ OR: [{ digestOnly: true }, { priority: { in: ['medium', 'low'] } }] }],
    };
    if (userId) {
      where.AND.push({ OR: [{ userId }, { userId: null }] });
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      critical: notifications.filter((n) => n.priority === 'critical'),
      high: notifications.filter((n) => n.priority === 'high'),
      medium: notifications.filter((n) => n.priority === 'medium'),
      low: notifications.filter((n) => n.priority === 'low'),
      total: notifications.length,
    };
  }
}
