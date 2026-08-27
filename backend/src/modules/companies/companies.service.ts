import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { acquireCronLock } from '../../common/scheduling/cron-lock';
import { UpdateCompanySettingsDto, UpdateCompanyFuelSettingsDto } from './dto/company-settings.dto';

const PURGE_GRACE_DAYS = parseInt(process.env.COMPANY_PURGE_GRACE_DAYS || '30', 10);

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('company-purge') private purgeQueue: Queue,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async schedulePendingPurges() {
    // Verrou distribué : une seule instance planifie les purges (les jobs BullMQ
    // sont idempotents mais inutile de les enfiler N fois).
    if (!(await acquireCronLock(this.redis, 'companies.schedulePendingPurges', 3600))) return;
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

    // Création idempotente (upsert) : deux requêtes simultanées sur une company
    // sans settings faisaient chacune un create → violation d'unicité P2002 → 500.
    await this.prisma.companySettings.upsert({
      where: { companyId },
      update: {},
      create: { companyId },
    });
    await this.prisma.companyFuelSettings.upsert({
      where: { companyId },
      update: {},
      create: { companyId },
    });

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
      // BadRequestException (400) et non Error brut : le filtre global convertit
      // un Error en 500 + Sentry/alerte alors que c'est une erreur client.
      throw new BadRequestException('Company name confirmation does not match');
    }

    // Soft delete - cascade will handle related entities
    await this.prisma.company.update({
      where: { id: companyId },
      data: { deletedAt: new Date() },
    });

    return { message: 'Company deleted successfully' };
  }
}
