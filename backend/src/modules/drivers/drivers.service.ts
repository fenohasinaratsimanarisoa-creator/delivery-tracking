import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
  constructor(
    private prisma: PrismaService,
    private dataUpdateBus: DataUpdateBus,
    private assignmentHistory: VehicleAssignmentHistoryService,
  ) {}

  async create(companyId: string, dto: CreateDriverDto) {
    const existing = await this.prisma.driver.findFirst({
      where: { companyId, licenseNumber: dto.licenseNumber, deletedAt: null },
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

    const driver = await this.prisma.$transaction(async (tx) => {
      const created = await tx.driver.create({
        data: { ...dto, companyId },
        include: {
          vehicle: {
            select: {
              id: true,
              brand: true,
              model: true,
              year: true,
              licensePlate: true,
              fuelType: true,
              positionSource: true,
            },
          },
        },
      });
      if (dto.vehicleId) {
        await this.assignmentHistory.assign(tx, {
          companyId,
          driverId: created.id,
          vehicleId: dto.vehicleId,
        });
      }
      return created;
    });
    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'driver',
      action: 'created',
      payload: { id: driver.id },
    });
    return driver;
  }

  async findByUserId(userId: string) {
    return this.prisma.driver.findFirst({
      where: { userId, deletedAt: null },
      include: {
        vehicle: {
          select: {
            id: true,
            brand: true,
            model: true,
            year: true,
            licensePlate: true,
            fuelType: true,
            positionSource: true,
          },
        },
      },
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
      const existing = await this.prisma.driver.findFirst({
        where: { companyId, licenseNumber: dto.licenseNumber, deletedAt: null },
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

    const driver = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.driver.update({
        where: { id },
        data: dto,
        include: {
          vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        },
      });
      if (dto.vehicleId !== undefined) {
        if (dto.vehicleId === null) {
          await this.assignmentHistory.unassign(tx, { driverId: id });
        } else {
          await this.assignmentHistory.assign(tx, {
            companyId,
            driverId: id,
            vehicleId: dto.vehicleId,
          });
        }
      }
      return updated;
    });
    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'driver',
      action: 'updated',
      payload: { id: driver.id },
    });
    return driver;
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    const inProgress = await this.prisma.delivery.findFirst({
      where: { driverId: id, status: 'in_progress', deletedAt: null },
    });
    if (inProgress) {
      throw new BadRequestException('Cannot delete driver assigned to an in-progress delivery');
    }

    const driver = await this.prisma.driver.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'driver',
      action: 'deleted',
      payload: { id: driver.id },
    });
    return driver;
  }
}
