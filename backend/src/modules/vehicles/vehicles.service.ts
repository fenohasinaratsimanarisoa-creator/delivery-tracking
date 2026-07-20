import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleFilterDto } from './dto/vehicle-filter.dto';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findUnique({
      where: { licensePlate: dto.licensePlate },
    });
    if (existing) {
      throw new ConflictException('License plate already exists');
    }

    return this.prisma.vehicle.create({
      data: { ...dto, companyId },
    });
  }

  async findAll(companyId: string, filter: VehicleFilterDto) {
    const where: any = { companyId };

    if (filter.search) {
      where.OR = [
        { brand: { contains: filter.search, mode: 'insensitive' } },
        { model: { contains: filter.search, mode: 'insensitive' } },
        { licensePlate: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    if (filter.brand) {
      where.brand = { equals: filter.brand, mode: 'insensitive' };
    }
    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(companyId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, companyId },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async update(companyId: string, id: string, dto: UpdateVehicleDto) {
    await this.findOne(companyId, id);

    if (dto.licensePlate) {
      const existing = await this.prisma.vehicle.findUnique({
        where: { licensePlate: dto.licensePlate },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('License plate already in use');
      }
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: dto,
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.vehicle.delete({ where: { id } });
  }
}
