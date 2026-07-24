import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { formatDate, type Language } from '../../common/i18n';

@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
  ) {}

  @Cron('0 8 * * 1')
  async sendWeeklyDigest() {
    this.logger.log('Generating weekly digest...');

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);

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
        const [deliveries, fuelAnomalies] = await Promise.all([
          this.prisma.delivery.findMany({
            where: {
              companyId: company.id,
              createdAt: { gte: weekAgo },
            },
          }),
          this.prisma.fuelLog.findMany({
            where: {
              companyId: company.id,
              anomalyFlag: true,
              createdAt: { gte: weekAgo },
            },
            include: { vehicle: { select: { licensePlate: true } } },
          }),
        ]);

        const totalDeliveries = deliveries.length;
        const delivered = deliveries.filter((d) => d.status === 'delivered').length;
        const failed = deliveries.filter((d) => d.status === 'failed').length;
        const punctuality =
          totalDeliveries > 0 ? Math.round((delivered / totalDeliveries) * 100) : 100;

        const pendingAnomalies = fuelAnomalies.filter((a) => a.anomalyFlag);

        for (const user of company.users) {
          const lang: Language = (user as any).lang || 'fr';
          await this.emailService.sendDigest(user.email, user.firstName, {
            companyName: company.name,
            weekRange: this.formatWeekRange(weekAgo, lang),
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
          }, lang);
        }

        this.logger.log(`Digest sent for company ${company.id} (${company.name})`);
      } catch (err) {
        this.logger.error(`Failed to send digest for company ${company.id}`, err);
      }
    }
  }

  private formatWeekRange(weekAgo: Date, lang: Language): string {
    const now = new Date();
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
    return `${formatDate(weekAgo, lang, options)} — ${formatDate(now, lang, options)}`;
  }
}
