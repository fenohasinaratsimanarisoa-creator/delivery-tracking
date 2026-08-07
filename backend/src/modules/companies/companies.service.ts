import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateCompanySettingsDto, UpdateCompanyFuelSettingsDto } from './dto/company-settings.dto';

const PURGE_GRACE_DAYS = parseInt(process.env.COMPANY_PURGE_GRACE_DAYS || '30', 10);

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('company-purge') private purgeQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async schedulePendingPurges() {
    const cutoff = new Date(Date.now() - PURGE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.company.findMany({
      where: { deletedAt: { not: null, lte: cutoff } },
      select: { id: true, name: true, deletedAt: true },
    });
    for (const company of expired) {
      await this.purgeQueue.add('purge', { companyId: company.id });
      this.logger.log(
        `Scheduled purge for company ${company.id} (deleted ${company.deletedAt?.toISOString()})`,
      );
    }
  }

  async getSettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        settings: true,
        fuelSettings: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // Create default settings if they don't exist
    if (!company.settings) {
      await this.prisma.companySettings.create({
        data: { companyId },
      });
    }

    if (!company.fuelSettings) {
      await this.prisma.companyFuelSettings.create({
        data: { companyId },
      });
    }

    // Re-fetch with created settings
    return this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        settings: true,
        fuelSettings: true,
      },
    });
  }

  async updateSettings(companyId: string, dto: UpdateCompanySettingsDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    const { billingEmail, billingAddress, billingTaxId, ...companyData } = dto;

    await this.prisma.company.update({
      where: { id: companyId },
      data: companyData,
    });

    // Update company settings
    await this.prisma.companySettings.upsert({
      where: { companyId },
      update: {
        billingEmail,
        billingAddress,
        billingTaxId,
      },
      create: {
        companyId,
        billingEmail,
        billingAddress,
        billingTaxId,
      },
    });

    return this.getSettings(companyId);
  }

  async updateFuelSettings(companyId: string, dto: UpdateCompanyFuelSettingsDto) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    await this.prisma.companyFuelSettings.upsert({
      where: { companyId },
      update: dto,
      create: {
        companyId,
        ...dto,
      },
    });

    return this.getSettings(companyId);
  }

  async deleteCompany(companyId: string, confirmationName: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    if (company.name !== confirmationName) {
      throw new Error('Company name confirmation does not match');
    }

    // Soft delete - cascade will handle related entities
    await this.prisma.company.update({
      where: { id: companyId },
      data: { deletedAt: new Date() },
    });

    return { message: 'Company deleted successfully' };
  }
}
