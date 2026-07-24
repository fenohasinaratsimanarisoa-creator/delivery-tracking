import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DeliveryStatus, NotificationType, NotificationPriority } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { haversineDistance } from '../../common/geo/geo.utils';
import { t, type Language } from '../../common/i18n';

const TRANSITION_MATRIX: Record<DeliveryStatus, DeliveryStatus[]> = {
  [DeliveryStatus.pending]: [DeliveryStatus.assigned, DeliveryStatus.cancelled],
  [DeliveryStatus.assigned]: [DeliveryStatus.in_progress, DeliveryStatus.cancelled],
  [DeliveryStatus.in_progress]: [
    DeliveryStatus.delivered,
    DeliveryStatus.failed,
    DeliveryStatus.cancelled,
  ],
  [DeliveryStatus.delivered]: [],
  [DeliveryStatus.failed]: [],
  [DeliveryStatus.cancelled]: [],
};

@Injectable()
export class DeliveriesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private configService: ConfigService,
  ) {}

  async create(companyId: string, dto: CreateDeliveryDto) {
    let assignedDriverId: string | undefined;
    if (dto.driverId) {
      const driver = await this.prisma.driver.findUnique({
        where: { id: dto.driverId },
        select: { userId: true },
      });
      if (driver?.userId) assignedDriverId = driver.userId;
    }
    const delivery = await this.prisma.delivery.create({
      data: {
        ...dto,
        assignedDriverId,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        companyId,
      },
      include: { vehicle: true, driver: true },
    });

    await this.webhooks.dispatch('delivery.status_changed', {
      deliveryId: delivery.id,
      companyId,
      title: delivery.title,
      status: delivery.status,
    });

    return delivery;
  }

  async findMyOrders(clientId: string, companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { clientId, companyId, deletedAt: null };
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
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findMyDeliveries(userId: string, companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { assignedDriverId: userId, companyId, deletedAt: null };
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
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async updateDriverStatus(
    companyId: string,
    id: string,
    userId: string,
    dto: UpdateDeliveryStatusDto,
    lang: Language = 'fr',
  ) {
    const delivery = await this.findOne(companyId, id);
    if (delivery.assignedDriverId !== userId) {
      throw new BadRequestException('This delivery is not assigned to you');
    }

    const allowedTransitions = TRANSITION_MATRIX[delivery.status];
    const driverAllowed: DeliveryStatus[] = allowedTransitions.filter(
      (s) =>
        s === DeliveryStatus.in_progress ||
        s === DeliveryStatus.delivered ||
        s === DeliveryStatus.failed,
    );

    if (!driverAllowed.includes(dto.status)) {
      throw new BadRequestException(
        `Driver cannot transition from ${delivery.status} to ${dto.status}. Allowed: ${driverAllowed.join(', ') || 'none'}`,
      );
    }

    const proofData = await this.verifyDeliveryLocation(companyId, delivery, dto, lang);
    const updateData: any = { ...proofData, status: dto.status };
    if (dto.status === DeliveryStatus.delivered) {
      updateData.completedAt = new Date();
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: { vehicle: true, driver: true },
    });

    const statusLabel = dto.status.replace('_', ' ');
    await this.notifications.create(companyId, {
      type: NotificationType.delivery_status,
      priority:
        dto.status === DeliveryStatus.delivered
          ? NotificationPriority.low
          : NotificationPriority.high,
      title: t('delivery.notification.title', lang, { status: statusLabel }),
      message: t('delivery.notification.message', lang, {
        title: updated.title,
        status: statusLabel,
      }),
      link: `/deliveries/${id}`,
      deliveryId: id,
    });

    await this.dispatchWebhook(companyId, updated, dto.status);

    return updated;
  }

  async findAll(companyId: string, page = 1, limit = 20, status?: DeliveryStatus) {
    const skip = (page - 1) * limit;
    const where: any = { companyId, deletedAt: null };
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
      where: { id, companyId, deletedAt: null },
      include: {
        vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  async update(companyId: string, id: string, dto: UpdateDeliveryDto) {
    const delivery = await this.findOne(companyId, id);

    const updateData: any = { ...dto };
    if (dto.scheduledDate) {
      updateData.scheduledDate = new Date(dto.scheduledDate);
    }
    if (dto.driverId) {
      const driver = await this.prisma.driver.findUnique({
        where: { id: dto.driverId },
        select: { userId: true },
      });
      if (driver?.userId) updateData.assignedDriverId = driver.userId;
    }
    if (
      dto.status &&
      dto.status !== delivery.status &&
      (dto.status === ('delivered' as DeliveryStatus) ||
        dto.status === ('failed' as DeliveryStatus))
    ) {
      const allowed = TRANSITION_MATRIX[delivery.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot transition from ${delivery.status} to ${dto.status}`);
      }
      if (dto.status === ('delivered' as DeliveryStatus)) {
        updateData.completedAt = new Date();
      }
    }

    return this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: { vehicle: true, driver: true },
    });
  }

  async updateStatus(
    companyId: string,
    id: string,
    dto: UpdateDeliveryStatusDto,
    lang: Language = 'fr',
  ) {
    const delivery = await this.findOne(companyId, id);
    const allowedTransitions = TRANSITION_MATRIX[delivery.status];

    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${delivery.status} to ${dto.status}. Allowed: ${allowedTransitions.join(', ') || 'none'}`,
      );
    }

    const proofData = await this.verifyDeliveryLocation(companyId, delivery, dto, lang);
    const updateData: any = { ...proofData, status: dto.status };
    if (dto.status === DeliveryStatus.delivered) {
      updateData.completedAt = new Date();
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: { vehicle: true, driver: true, assignedDriver: true },
    });

    const statusLabel = dto.status.replace('_', ' ');
    await this.notifications.create(companyId, {
      type: NotificationType.delivery_status,
      priority:
        dto.status === DeliveryStatus.delivered
          ? NotificationPriority.low
          : dto.status === DeliveryStatus.failed
            ? NotificationPriority.high
            : NotificationPriority.medium,
      title: t('delivery.notification.title', lang, { status: statusLabel }),
      message: t('delivery.notification.message', lang, {
        title: updated.title,
        status: statusLabel,
      }),
      link: `/deliveries/${id}`,
      userId: updated.assignedDriverId ?? undefined,
      deliveryId: id,
    });

    await this.dispatchWebhook(companyId, updated, dto.status);

    return updated;
  }

  async resolveMismatch(companyId: string, id: string) {
    const delivery = await this.findOne(companyId, id);
    if (!delivery.locationMismatch) {
      throw new BadRequestException('This delivery has no location mismatch');
    }
    return this.prisma.delivery.update({
      where: { id },
      data: { mismatchResolved: true },
    });
  }

  async remove(companyId: string, id: string) {
    const delivery = await this.findOne(companyId, id);
    if (delivery.status === 'in_progress') {
      throw new BadRequestException('Cannot delete a delivery that is in progress');
    }

    return this.prisma.delivery.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  static isValidTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
    return TRANSITION_MATRIX[from]?.includes(to) ?? false;
  }

  private async verifyDeliveryLocation(
    companyId: string,
    delivery: any,
    dto: UpdateDeliveryStatusDto,
    lang: Language = 'fr',
  ): Promise<Record<string, any>> {
    const proofData: Record<string, any> = {};

    if (
      (dto.status !== DeliveryStatus.delivered && dto.status !== DeliveryStatus.failed) ||
      dto.latitude === undefined ||
      dto.longitude === undefined
    ) {
      return proofData;
    }

    proofData.deliveryProofLat = dto.latitude;
    proofData.deliveryProofLng = dto.longitude;
    if (dto.accuracy !== undefined) {
      proofData.deliveryProofAccuracy = dto.accuracy;
    }

    if (delivery.deliveryLat !== null && delivery.deliveryLng !== null) {
      const distance = Math.round(
        haversineDistance(dto.latitude, dto.longitude, delivery.deliveryLat, delivery.deliveryLng),
      );
      proofData.deliveryProofDistance = distance;

      const threshold = this.configService.get<number>('LOCATION_MISMATCH_THRESHOLD_M', 200);
      if (distance > threshold) {
        proofData.locationMismatch = true;
        proofData.mismatchResolved = false;

        await this.notifications.create(companyId, {
          type: NotificationType.location_mismatch,
          priority: NotificationPriority.high,
          title: t('delivery.notification.mismatchTitle', lang),
          message: t('delivery.notification.mismatchMessage', lang, {
            title: delivery.title,
            distance: (distance / 1000).toFixed(1),
            meters: distance,
          }),
          link: `/deliveries/${delivery.id}`,
          deliveryId: delivery.id,
        });
      } else {
        proofData.locationMismatch = false;
        proofData.mismatchResolved = false;
      }
    }

    return proofData;
  }

  private async dispatchWebhook(companyId: string, delivery: any, status: DeliveryStatus) {
    await this.webhooks.dispatch('delivery.status_changed', {
      deliveryId: delivery.id,
      companyId,
      title: delivery.title,
      status,
      pickupAddress: delivery.pickupAddress,
      deliveryAddress: delivery.deliveryAddress,
      driverName: delivery.driver
        ? `${delivery.driver.firstName} ${delivery.driver.lastName}`
        : null,
    });

    if (status === DeliveryStatus.delivered) {
      await this.webhooks.dispatch('delivery.delivered', {
        deliveryId: delivery.id,
        companyId,
        title: delivery.title,
        completedAt: new Date().toISOString(),
        deliveryAddress: delivery.deliveryAddress,
      });
    }
  }
}
