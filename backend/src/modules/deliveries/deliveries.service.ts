import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';

const TRANSITION_MATRIX: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.pending]: [DeliveryStatus.assigned, DeliveryStatus.cancelled],
  [DeliveryStatus.assigned]: [DeliveryStatus.in_progress, DeliveryStatus.cancelled],
  [DeliveryStatus.in_progress]: [DeliveryStatus.delivered, DeliveryStatus.failed, DeliveryStatus.cancelled],
  [DeliveryStatus.delivered]: [],
  [DeliveryStatus.failed]: [],
  [DeliveryStatus.cancelled]: [],
};

@Injectable()
export class DeliveriesService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateDeliveryDto) {
    return this.prisma.delivery.create({
      data: {
        ...dto,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        companyId,
      },
      include: { vehicle: true, driver: true },
    });
  }

  async findAll(
    companyId: string,
    page = 1,
    limit = 20,
    status?: DeliveryStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { companyId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
          driver: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(companyId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, companyId },
      include: {
        vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  async update(companyId: string, id: string, dto: UpdateDeliveryDto) {
    await this.findOne(companyId, id);
    return this.prisma.delivery.update({
      where: { id },
      data: {
        ...dto,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
      },
      include: { vehicle: true, driver: true },
    });
  }

  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdateDeliveryStatusDto,
  ) {
    const delivery = await this.findOne(companyId, id);
    const allowedTransitions = TRANSITION_MATRIX[delivery.status];

    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${delivery.status} to ${dto.status}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      );
    }

    const updateData: any = { status: dto.status };
    if (dto.status === DeliveryStatus.delivered) {
      updateData.completedAt = new Date();
    }

    return this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: { vehicle: true, driver: true },
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);
    return this.prisma.delivery.delete({ where: { id } });
  }

  static isValidTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
    return TRANSITION_MATRIX[from]?.includes(to) ?? false;
  }
}
