import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DeliveryStatus, NotificationType, NotificationPriority, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { GeocodingService } from '../geocoding/geocoding.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { haversineDistance } from '../../common/geo/geo.utils';
import { t, type Language } from '../../common/i18n';
import { parseAmount } from '../../common/utils/parse-amount';

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
    private dataUpdateBus: DataUpdateBus,
    private geocoding: GeocodingService,
  ) {}

  async create(companyId: string, dto: CreateDeliveryDto) {
    let assignedDriverId: string | undefined;
    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId, deletedAt: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found in your company');
    }
    if (dto.driverId) {
      const driver = await this.prisma.driver.findFirst({
        where: { id: dto.driverId, companyId, deletedAt: null },
        select: { userId: true },
      });
      if (!driver) throw new NotFoundException('Driver not found in your company');
      if (driver.userId) assignedDriverId = driver.userId;
    }
    // Auto-geocode delivery address if coordinates are not provided
    let deliveryLat = dto.deliveryLat;
    let deliveryLng = dto.deliveryLng;
    if (deliveryLat === undefined && deliveryLng === undefined && dto.deliveryAddress) {
      try {
        const results = await this.geocoding.search(dto.deliveryAddress);
        if (results.length > 0) {
          deliveryLat = results[0].lat;
          deliveryLng = results[0].lng;
        }
      } catch {}
    }

    const delivery = await this.prisma.delivery.create({
      data: {
        ...dto,
        deliveryLat,
        deliveryLng,
        status: dto.status ?? DeliveryStatus.pending,
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

    this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: delivery.status, payload: { id: delivery.id } });

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

    this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: dto.status, payload: { id } });

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

  async findOne(companyId: string, id: string, role?: string, userId?: string) {
    const where: any = { id, companyId, deletedAt: null };
    if (role === 'client') where.clientId = userId;
    if (role === 'driver') where.assignedDriverId = userId;
    const delivery = await this.prisma.delivery.findFirst({
      where,
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
    if (dto.deliveryLat === undefined && dto.deliveryLng === undefined && dto.deliveryAddress && dto.deliveryAddress !== delivery.deliveryAddress) {
      try {
        const results = await this.geocoding.search(dto.deliveryAddress);
        if (results.length > 0) {
          updateData.deliveryLat = results[0].lat;
          updateData.deliveryLng = results[0].lng;
        }
      } catch {}
    }
    if (dto.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId, deletedAt: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found in your company');
    }
    if (dto.driverId) {
      const driver = await this.prisma.driver.findFirst({
        where: { id: dto.driverId, companyId, deletedAt: null },
        select: { userId: true },
      });
      if (!driver) throw new NotFoundException('Driver not found in your company');
      if (driver.userId) updateData.assignedDriverId = driver.userId;
    }
    if (dto.status && dto.status !== delivery.status) {
      const allowed = TRANSITION_MATRIX[delivery.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot transition from ${delivery.status} to ${dto.status}`);
      }
      if (dto.status === DeliveryStatus.delivered) {
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

    this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: dto.status, payload: { id } });

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

    let destLat = delivery.deliveryLat;
    let destLng = delivery.deliveryLng;
    if (destLat == null && destLng == null && delivery.deliveryAddress) {
      try {
        const results = await this.geocoding.search(delivery.deliveryAddress);
        if (results.length > 0) {
          destLat = results[0].lat;
          destLng = results[0].lng;
          await this.prisma.delivery.update({
            where: { id: delivery.id },
            data: { deliveryLat: destLat, deliveryLng: destLng },
          });
        }
      } catch {}
    }

    if (destLat != null && destLng != null) {
      const distance = Math.round(
        haversineDistance(dto.latitude, dto.longitude, destLat, destLng),
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
    } else {
      proofData.locationMismatch = true;
      proofData.mismatchResolved = false;
      await this.notifications.create(companyId, {
        type: NotificationType.location_mismatch,
        priority: NotificationPriority.high,
        title: t('delivery.notification.mismatchTitle', lang),
        message: t('delivery.notification.noCoordsMessage', lang, {
          title: delivery.title,
        }),
        link: `/deliveries/${delivery.id}`,
        deliveryId: delivery.id,
      });
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

  async findProofs(companyId: string, page = 1, limit = 20, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {
      companyId,
      deletedAt: null,
      status: { in: ['delivered', 'failed'] },
    };
    if (status && ['delivered', 'failed'].includes(status)) {
      where.status = status;
    }

    const [data, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        skip,
        take: limit,
        orderBy: { completedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          deliveryAddress: true,
          deliveryLat: true,
          deliveryLng: true,
          deliveryProofLat: true,
          deliveryProofLng: true,
          deliveryProofDistance: true,
          deliveryProofAccuracy: true,
          locationMismatch: true,
          mismatchResolved: true,
          completedAt: true,
          scheduledDate: true,
          pickupAddress: true,
          driver: { select: { id: true, firstName: true, lastName: true } },
          assignedDriver: { select: { id: true, firstName: true, lastName: true } },
          vehicle: { select: { id: true, licensePlate: true, brand: true, model: true } },
        },
      }),
      this.prisma.delivery.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async bulkAction(companyId: string, dto: { ids: string[]; action: string; status?: string; driverId?: string }): Promise<{
    succeeded: string[];
    failed: { id: string; reason: string }[];
  }> {
    const result = { succeeded: [] as string[], failed: [] as { id: string; reason: string }[] };

    if (dto.ids.length === 0) return result;

    const deliveries = await this.prisma.delivery.findMany({
      where: { id: { in: dto.ids }, companyId, deletedAt: null },
    });
    const deliveryMap = new Map(deliveries.map((d) => [d.id, d]));

    for (const id of dto.ids) {
      try {
        const delivery = deliveryMap.get(id);
        if (!delivery) {
          result.failed.push({ id, reason: 'Delivery not found' });
          continue;
        }

        if (dto.action === 'delete') {
          if (delivery.status === DeliveryStatus.in_progress) {
            result.failed.push({ id, reason: 'Cannot delete a delivery in progress' });
            continue;
          }
          await this.prisma.delivery.update({
            where: { id },
            data: { deletedAt: new Date() },
          });
          result.succeeded.push(id);
        } else if (dto.action === 'updateStatus' && dto.status) {
          const targetStatus = dto.status as DeliveryStatus;
          const allowed = TRANSITION_MATRIX[delivery.status];
          if (!allowed.includes(targetStatus)) {
            result.failed.push({ id, reason: `Transition ${delivery.status} → ${targetStatus} not allowed` });
            continue;
          }
          const updateData: any = { status: targetStatus };
          if (targetStatus === DeliveryStatus.delivered) {
            updateData.completedAt = new Date();
          }
          await this.prisma.delivery.update({ where: { id }, data: updateData });
          this.webhooks.dispatch('delivery.status_changed', {
            deliveryId: id,
            companyId,
            title: delivery.title,
            status: targetStatus,
          });
          this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: targetStatus, payload: { id } });
          result.succeeded.push(id);
        } else if (dto.action === 'assignDriver') {
          if (!dto.driverId) {
            result.failed.push({ id, reason: 'No driver provided' });
            continue;
          }
          const driver = await this.prisma.driver.findFirst({
            where: { id: dto.driverId, companyId, deletedAt: null },
            select: { userId: true },
          });
          if (!driver) {
            result.failed.push({ id, reason: 'Driver not found in your company' });
            continue;
          }
          await this.prisma.delivery.update({
            where: { id },
            data: {
              driverId: dto.driverId,
              ...(driver.userId ? { assignedDriverId: driver.userId } : {}),
            },
          });
          this.webhooks.dispatch('delivery.driver_assigned', {
            deliveryId: id,
            companyId,
            title: delivery.title,
            driverId: dto.driverId,
          });
          this.dataUpdateBus.emitUpdate({ companyId, entity: 'delivery', action: 'assigned', payload: { id, driverId: dto.driverId } });
          result.succeeded.push(id);
        } else {
          result.failed.push({ id, reason: `Unknown action: ${dto.action}` });
        }
      } catch (err: any) {
        result.failed.push({ id, reason: err.message || 'Internal error' });
      }
    }

    Logger.log(`Bulk action "${dto.action}": ${result.succeeded.length} succeeded, ${result.failed.length} failed`, 'DeliveriesService');
    return result;
  }

  async importExcel(
    companyId: string,
    fileBuffer: Uint8Array,
    defaultPickupAddress: string,
    mode: 'create-only' | 'upsert' = 'create-only',
  ): Promise<{
    created: number;
    updated: number;
    skipped: { row: number; orderRef: string; reason: string }[];
    errors: { row: number; reason: string }[];
  }> {
    const workbook = new ExcelJS.Workbook();
    await (workbook.xlsx as any).load(fileBuffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('Le fichier Excel est vide');

    const headerRow = worksheet.getRow(1);
    const colMap = new Map<string, number>();
    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').trim();
      if (val) colMap.set(val, colNumber);
    });

    const getCol = (row: number, name: string): string | undefined => {
      const col = colMap.get(name);
      if (!col) return undefined;
      const cell = worksheet.getRow(row).getCell(col);
      const v = cell.value;
      if (v === null || v === undefined) return undefined;
      return String(v).trim();
    };

    const result = {
      created: 0,
      updated: 0,
      skipped: [] as { row: number; orderRef: string; reason: string }[],
      errors: [] as { row: number; reason: string }[],
    };
    const toCreate: any[] = [];

    const totalRows = worksheet.rowCount;
    for (let rowNum = 2; rowNum <= totalRows; rowNum++) {
      const orderRef = getCol(rowNum, 'N° Commande');
      const lieu = getCol(rowNum, 'Lieu');

      if (!orderRef) {
        result.errors.push({ row: rowNum, reason: 'N° Commande manquant' });
        continue;
      }
      if (!lieu) {
        result.errors.push({ row: rowNum, reason: 'Lieu (adresse de livraison) manquant' });
        continue;
      }

      const existing = await this.prisma.delivery.findFirst({
        where: { companyId, externalOrderRef: orderRef, deletedAt: null },
        select: { id: true, status: true },
      });

      const adresse = getCol(rowNum, 'Adresse') || undefined;
      const telephone = getCol(rowNum, 'Téléphone') || undefined;
      const montant = parseAmount(getCol(rowNum, 'Montant'));
      const prix = parseAmount(getCol(rowNum, 'Prix'));
      const produits = getCol(rowNum, 'Produits commandés') || undefined;
      const observation = getCol(rowNum, 'Observation');
      const notesExistantes = getCol(rowNum, 'Notes');
      const notes = [notesExistantes, observation ? `Observation: ${observation}` : null].filter(Boolean).join('\n') || undefined;

      if (existing) {
        if (mode === 'create-only') {
          result.skipped.push({ row: rowNum, orderRef, reason: 'duplicate' });
          continue;
        }
        // upsert mode: update fields but NEVER regress a status that has progressed beyond in_progress
        // (delivered, failed, cancelled) — those terminal states must stay unchanged.
        const newStatus = existing.status;
        const updateData: any = {
          deliveryAddress: lieu,
          deliveryLocationLabel: adresse,
          clientPhone: telephone,
          amount: montant,
          articlePrice: prix,
          productDescription: produits,
          description: produits || undefined,
          notes: notes || undefined,
          pickupAddress: defaultPickupAddress,
          ...(newStatus ? {} : { status: DeliveryStatus.in_progress }),
        };
        await this.prisma.delivery.update({
          where: { id: existing.id },
          data: updateData,
        });
        result.updated++;
        continue;
      }

      const data = {
        title: orderRef,
        externalOrderRef: orderRef,
        deliveryAddress: lieu,
        deliveryLocationLabel: adresse,
        clientPhone: telephone,
        amount: montant,
        articlePrice: prix,
        productDescription: produits,
        description: produits || undefined,
        notes: notes || undefined,
        pickupAddress: defaultPickupAddress,
        status: DeliveryStatus.in_progress,
        companyId,
      };

      // Per-row create with safety net: if the pre-check (findFirst above) missed a duplicate
      // (e.g. two rows in the same file with the same externalOrderRef, or a race condition
      // with a concurrent import), the P2002 is caught and converted to 'skipped' instead of
      // crashing the entire import.
      try {
        await this.prisma.delivery.create({ data });
        result.created++;
      } catch (err: any) {
        if ((err instanceof Prisma.PrismaClientKnownRequestError || err?.name === 'PrismaClientKnownRequestError') && err?.code === 'P2002') {
          result.skipped.push({ row: rowNum, orderRef, reason: 'duplicate' });
        } else {
          result.errors.push({ row: rowNum, reason: err instanceof Error ? err.message : 'Erreur inconnue' });
        }
      }
    }
    Logger.log(`Import Excel (${mode}): ${result.created} créées, ${result.updated} mises à jour, ${result.skipped.length} ignorées, ${result.errors.length} erreurs`, 'DeliveriesService');
    return result;
  }
}
