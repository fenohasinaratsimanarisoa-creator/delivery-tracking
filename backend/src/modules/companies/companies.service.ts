import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateCompanySettingsDto, UpdateCompanyFuelSettingsDto } from './dto/company-settings.dto';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

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
