import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
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

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId, deletedAt: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');

      const alreadyAssigned = await this.prisma.driver.findFirst({
        where: { vehicleId: dto.vehicleId, deletedAt: null },
      });
      if (alreadyAssigned) {
        throw new ConflictException('Vehicle is already assigned to another driver');
      }
    }

    return this.prisma.driver.create({
      data: { ...dto, companyId },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
  }

  async findByUserId(userId: string) {
    return this.prisma.driver.findFirst({
      where: { userId, deletedAt: null },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
  }

  async findAll(companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { companyId, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        },
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
      where: { id, companyId, deletedAt: null },
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

    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId, deletedAt: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found');

      const alreadyAssigned = await this.prisma.driver.findFirst({
        where: { vehicleId: dto.vehicleId, deletedAt: null, id: { not: id } },
      });
      if (alreadyAssigned) {
        throw new ConflictException('Vehicle is already assigned to another driver');
      }
    }

    return this.prisma.driver.update({
      where: { id },
      data: dto,
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    const inProgress = await this.prisma.delivery.findFirst({
      where: { driverId: id, status: 'in_progress', deletedAt: null },
    });
    if (inProgress) {
      throw new BadRequestException('Cannot delete driver assigned to an in-progress delivery');
    }

    return this.prisma.driver.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
