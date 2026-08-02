import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { formatDate, type Language } from '../../common/i18n';
import { hasFuelAnomaly } from '../../common/fuel/fuel-anomaly.utils';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  @Cron('0 8 * * 1')
  async sendWeeklyDigest() {
    await this.sendDigest(7);
  }

  @Cron('0 20 * * *')
  async sendDailyDigest() {
    await this.sendDigest(1);
  }

  private async sendDigest(daysBack: number) {
    this.logger.log(`Generating ${daysBack === 1 ? 'daily' : 'weekly'} digest...`);

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - daysBack);

    const companies = await this.prisma.company.findMany({
      include: {
        users: {
          where: {
            role: { in: ['admin', 'dispatcher'] },
            isActive: true,
          },
        },
      },
    });

    for (const company of companies) {
      try {
        const [deliveries, fuelAnomalies, groupedNotifications] = await Promise.all([
          this.prisma.delivery.findMany({
            where: { companyId: company.id, createdAt: { gte: since } },
          }),
          this.prisma.fuelLog.findMany({
            where: {
              companyId: company.id,
              createdAt: { gte: since },
              OR: [{ consumptionAnomalyFlag: true }, { gpsAnomalyFlag: true }],
            },
            include: { vehicle: { select: { licensePlate: true } } },
          }),
          this.notificationsService.getDigestNotifications(company.id, since),
        ]);

        const totalDeliveries = deliveries.length;
        const delivered = deliveries.filter((d) => d.status === 'delivered').length;
        const failed = deliveries.filter((d) => d.status === 'failed').length;
        const punctuality = totalDeliveries > 0 ? Math.round((delivered / totalDeliveries) * 100) : 100;

        const pendingAnomalies = fuelAnomalies.filter((a) => hasFuelAnomaly(a));

        for (const user of company.users) {
          const lang: Language = (user as any).lang || 'fr';
          await this.emailService.sendDigest(
            user.email,
            user.firstName,
            {
              companyName: company.name,
              weekRange: this.formatWeekRange(since, lang),
              totalDeliveries,
              delivered,
              failed,
              punctuality,
              pendingAnomalies: pendingAnomalies.length,
              anomalyDetails: pendingAnomalies.map((a) => ({
                vehicle: a.vehicle.licensePlate,
                liters: a.liters,
                date: formatDate(a.fillDate, lang),
              })),
              notificationCount: groupedNotifications.total,
              notificationCritical: groupedNotifications.critical.length,
              notificationHigh: groupedNotifications.high.length,
              notificationMedium: groupedNotifications.medium.length,
              notificationLow: groupedNotifications.low.length,
            },
            lang,
          );
        }

        // Mark all digested notifications as sent
        const allNotifIds = [
          ...groupedNotifications.critical,
          ...groupedNotifications.high,
          ...groupedNotifications.medium,
          ...groupedNotifications.low,
        ].map((n) => n.id);
        if (allNotifIds.length > 0) {
          await this.prisma.notification.updateMany({
            where: { id: { in: allNotifIds } },
            data: { digestSentAt: new Date() },
          });
        }

        this.logger.log(`Digest sent for company ${company.id} (${company.name})`);
      } catch (err) {
        this.logger.error(`Failed to send digest for company ${company.id}`, err);
      }
    }
  }

  private formatWeekRange(since: Date, lang: Language): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    return `${formatDate(since, lang, options)} — ${formatDate(now, lang, options)}`;
  }
}