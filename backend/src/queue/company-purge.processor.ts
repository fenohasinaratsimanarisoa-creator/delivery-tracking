import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';

const COMPANY_PURGE_GRACE_DAYS = parseInt(process.env.COMPANY_PURGE_GRACE_DAYS || '30', 10);

interface CompanyPurgeJobData {
  companyId: string;
}

@Processor('company-purge')
export class CompanyPurgeProcessor extends WorkerHost {
  private readonly logger = new Logger(CompanyPurgeProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<CompanyPurgeJobData>): Promise<void> {
    const { companyId } = job.data;
    this.logger.log(`Starting purge for company ${companyId} (grace period: ${COMPANY_PURGE_GRACE_DAYS}d)`);

    try {
      const company = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { deletedAt: true, name: true, email: true, phone: true, address: true },
      });

      if (!company || !company.deletedAt) {
        this.logger.warn(`Company ${companyId} not found or not soft-deleted`);
        return;
      }

      const graceMs = COMPANY_PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - company.deletedAt.getTime();
      if (elapsed < graceMs) {
        const remainingDays = Math.ceil((graceMs - elapsed) / (24 * 60 * 60 * 1000));
        this.logger.log(`Company ${companyId} still within grace period (${remainingDays}d remaining)`);
        return;
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.user.updateMany({
          where: { companyId },
          data: {
            email: 'redacted-' + companyId + '@deleted.local',
            firstName: '[Deleted]',
            lastName: '[Deleted]',
            phone: null,
            isActive: false,
            refreshTokenHash: null,
            resetTokenHash: null,
            resetTokenId: null,
            resetTokenExpiry: null,
            googleId: null,
            avatarUrl: null,
            totpSecret: null,
            totpEnabled: false,
            passwordHash: '[DELETED]',
          },
        });

        await tx.driver.updateMany({
          where: { companyId },
          data: {
            firstName: '[Deleted]',
            lastName: '[Deleted]',
            email: null,
            phone: null,
            licenseNumber: `DRV-DELETED-${companyId.slice(0, 8)}`,
            isActive: false,
          },
        });

        await tx.vehicle.updateMany({
          where: { companyId },
          data: {
            isActive: false,
            vin: null,
            traccarDeviceId: null,
          },
        });

        await tx.company.update({
          where: { id: companyId },
          data: {
            name: '[Deleted]',
            email: null,
            phone: null,
            address: null,
            logoUrl: null,
          },
        });
      });

      this.logger.log(`Company ${companyId} purge complete`);
    } catch (error) {
      this.logger.error(`Failed to purge company ${companyId}: ${error}`);
      throw error;
    }
  }
}
