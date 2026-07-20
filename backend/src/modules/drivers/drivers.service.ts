import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateDriverDto) {
    const existing = await this.prisma.driver.findUnique({
      where: { licenseNumber: dto.licenseNumber },
    });
    if (existing) {
      throw new ConflictException('License number already exists');
    }

    return this.prisma.driver.create({
      data: { ...dto, companyId },
    });
  }

  async findAll(companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { companyId };

    const [data, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
      }),
      this.prisma.driver.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(companyId: string, id: string) {
    const driver = await this.prisma.driver.findFirst({
      where: { id, companyId },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
    if (!driver) throw new NotFoundException('Driver not found');
    return driver;
  }

  async update(companyId: string, id: string, dto: UpdateDriverDto) {
    await this.findOne(companyId, id);

    if (dto.licenseNumber) {
      const existing = await this.prisma.driver.findUnique({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('License number already in use');
      }
    }

    return this.prisma.driver.update({ where: { id }, data: dto });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.driver.delete({ where: { id } });
  }
}
