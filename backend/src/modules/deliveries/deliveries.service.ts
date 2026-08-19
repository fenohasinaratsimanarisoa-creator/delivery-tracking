import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
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
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private configService: ConfigService,
    private dataUpdateBus: DataUpdateBus,
    private geocoding: GeocodingService,
    @Optional() @InjectQueue('fuel-analysis') private fuelAnalysisQueue?: Queue,
  ) {}

  /**
   * Uniquement les statuts finaux qui impliquent un trajet réel du chauffeur déclenchent
   * le recalcul du DailyFuelReport : delivered ET failed (le chauffeur a roulé dans les
   * deux cas, donc consommé). Exclut explicitement pending/assigned/in_progress/cancelled.
   */
  private isFuelReportTriggerStatus(status: DeliveryStatus): boolean {
    return status === DeliveryStatus.delivered || status === DeliveryStatus.failed;
  }

  /**
   * Ajoute un job 'recompute-driver-report' à la queue fuel-analysis pour recalculer le
   * DailyFuelReport du chauffeur concerné (temps réel, à chaque livraison terminée).
   * Strictement fire-and-forget : la réponse HTTP de complétion de livraison ne doit
   * JAMAIS attendre ce recalcul. @Optional() + try/catch : aucun plantage si Redis/BullMQ
   * n'est pas configuré (dev local sans Redis par exemple).
   */
  private dispatchDailyFuelReportRecompute(
    companyId: string,
    driverId?: string | null,
    status?: DeliveryStatus,
  ): void {
    if (!driverId) return;
    const date = new Date().toISOString();
    void this.enqueueDailyFuelReportRecompute(companyId, driverId, date, status);
  }

  private async enqueueDailyFuelReportRecompute(
    companyId: string,
    driverId: string,
    date: string,
    status?: DeliveryStatus,
  ): Promise<void> {
    try {
      if (this.fuelAnalysisQueue) {
        await this.fuelAnalysisQueue.add('recompute-driver-report', {
          companyId,
          driverId,
          date,
          ...(status ? { status } : {}),
        });
      }
    } catch (e: any) {
      Logger.warn(
        `Failed to dispatch daily fuel report recompute: ${e?.message}`,
        'DeliveriesService',
      );
    }
  }

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
      } catch (err) {
        this.logger.debug(
          `Auto-geocode failed for "${dto.deliveryAddress}" (best-effort, delivery still created): ${(err as Error).message}`,
        );
      }
    }

    const requestedStatus = dto.status ?? DeliveryStatus.pending;
    if (
      requestedStatus === DeliveryStatus.delivered ||
      requestedStatus === DeliveryStatus.failed ||
      requestedStatus === DeliveryStatus.cancelled
    ) {
      // Une livraison ne peut pas NAÎTRE dans un état terminal : ces statuts sont
      // réservés au flux d'exécution (updateStatus/updateDriverStatus), sinon une
      // création « delivered » contournait notification, preuve GPS et webhooks.
      throw new BadRequestException(
        `Cannot create a delivery with terminal status "${requestedStatus}"`,
      );
    }

    const delivery = await this.prisma.delivery.create({
      data: {
        ...dto,
        deliveryLat,
        deliveryLng,
        status: requestedStatus,
        assignedDriverId,
        scheduledDate: dto.scheduledDate ? new Date(dto.scheduledDate) : undefined,
        companyId,
      },
      include: { vehicle: true, driver: true },
    });

    await this.webhooks.dispatch('delivery.status_changed', companyId, {
      deliveryId: delivery.id,
      companyId,
      title: delivery.title,
      status: delivery.status,
    });

    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'delivery',
      action: delivery.status,
      payload: { id: delivery.id },
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

  /**
   * Verrou optimiste : le WHERE inclut le statut lu par findOne(). Si une
   * requête concurrente a modifié le statut entre-temps, Prisma ne matche
   * aucune ligne et lève P2025 → converti en 400 explicite au lieu d'un 500.
   */
  private async updateWithOptimisticLock(
    id: string,
    expectedStatus: DeliveryStatus,
    data: any,
    include: any,
  ) {
    try {
      return await this.prisma.delivery.update({
        where: { id, status: expectedStatus },
        data,
        include,
      });
    } catch (err: any) {
      const isRecordNotFound =
        (err instanceof Prisma.PrismaClientKnownRequestError ||
          err?.name === 'PrismaClientKnownRequestError') &&
        err?.code === 'P2025';
      if (isRecordNotFound) {
        throw new BadRequestException(
          'Ce statut a déjà été modifié entretemps, actualisez la page',
        );
      }
      throw err;
    }
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

    const updated = await this.updateWithOptimisticLock(id, delivery.status, updateData, {
      vehicle: true,
      driver: true,
    });

    // Recalcul du fuel report UNIQUEMENT si l'update a gagné le verrou optimiste :
    // un appel concurrent qui a perdu ne doit pas déclencher le job une 2e fois.
    if (this.isFuelReportTriggerStatus(dto.status)) {
      this.dispatchDailyFuelReportRecompute(companyId, delivery.driverId, dto.status);
    }

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

    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'delivery',
      action: dto.status,
      payload: { id },
    });

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
    if (
      dto.deliveryLat === undefined &&
      dto.deliveryLng === undefined &&
      dto.deliveryAddress &&
      dto.deliveryAddress !== delivery.deliveryAddress
    ) {
      try {
        const results = await this.geocoding.search(dto.deliveryAddress);
        if (results.length > 0) {
          updateData.deliveryLat = results[0].lat;
          updateData.deliveryLng = results[0].lng;
        }
      } catch (err) {
        this.logger.debug(
          `Auto-geocode failed for "${dto.deliveryAddress}" (best-effort, address kept as-is): ${(err as Error).message}`,
        );
      }
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
      // Chauffeur sans compte utilisateur (userId null) : on DOIT purger l'ancien
      // assignedDriverId, sinon l'ancien chauffeur garde l'accès à la livraison via
      // l'app (findMyDeliveries / updateDriverStatus) alors qu'il n'est plus affecté.
      updateData.assignedDriverId = driver.userId ?? null;
    }
    // Réaffectation du chauffeur via PATCH /deliveries/:id (SANS changement de statut) :
    // mêmes effets de bord que bulkAction('assignDriver') — webhook delivery.driver_assigned
    // + broadcast dataUpdate. Avant, un changement de chauffeur seul était silencieux :
    // l'app du chauffeur et les intégrations webhook n'étaient jamais informées (contrairement
    // au chemin bulkAction qui, lui, émettait les deux).
    const driverChanged = dto.driverId !== undefined && dto.driverId !== delivery.driverId;
    let statusChanged = false;
    if (dto.status && dto.status !== delivery.status) {
      const allowed = TRANSITION_MATRIX[delivery.status];
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot transition from ${delivery.status} to ${dto.status}`);
      }
      statusChanged = true;
      if (this.isFuelReportTriggerStatus(dto.status)) {
        if (dto.status === DeliveryStatus.delivered) {
          updateData.completedAt = new Date();
        }
        this.dispatchDailyFuelReportRecompute(
          companyId,
          dto.driverId ?? delivery.driverId,
          dto.status,
        );
      }
    }

    const updated = await this.prisma.delivery.update({
      where: { id },
      data: updateData,
      include: { vehicle: true, driver: true, assignedDriver: true },
    });

    // Un changement de statut via PATCH /deliveries/:id doit déclencher les MÊMES
    // effets de bord que l'endpoint dédié (updateStatus) : notification, webhook et
    // broadcast. Avant, ces événements étaient silencieusement perdus selon l'endpoint
    // utilisé (intégrations webhook ratant des livraisons livrées/échouées).
    if (statusChanged && dto.status) {
      const statusLabel = dto.status.replace('_', ' ');
      await this.notifications.create(companyId, {
        type: NotificationType.delivery_status,
        priority:
          dto.status === DeliveryStatus.delivered
            ? NotificationPriority.low
            : dto.status === DeliveryStatus.failed
              ? NotificationPriority.high
              : NotificationPriority.medium,
        title: `Livraison ${statusLabel}`,
        message: `${updated.title} est maintenant ${statusLabel}`,
        link: `/deliveries/${id}`,
        userId: updated.assignedDriverId ?? undefined,
        deliveryId: id,
      });
      await this.dispatchWebhook(companyId, updated, dto.status);
      this.dataUpdateBus.emitUpdate({
        companyId,
        entity: 'delivery',
        action: dto.status,
        payload: { id },
      });
    }

    // Réaffectation du chauffeur seule (sans statut) : émission du webhook + broadcast
    // (aligné sur bulkAction assignDriver, mêmes payloads). Pas de notification ici :
    // le changement de statut (si présent) a déjà sa propre notification ci-dessus.
    if (driverChanged && dto.driverId) {
      await this.webhooks.dispatch('delivery.driver_assigned', companyId, {
        deliveryId: id,
        companyId,
        title: updated.title,
        driverId: dto.driverId,
      });
      this.dataUpdateBus.emitUpdate({
        companyId,
        entity: 'delivery',
        action: 'assigned',
        payload: { id, driverId: dto.driverId },
      });
    }

    return updated;
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

    const updated = await this.updateWithOptimisticLock(id, delivery.status, updateData, {
      vehicle: true,
      driver: true,
      assignedDriver: true,
    });

    // Recalcul du fuel report UNIQUEMENT si l'update a gagné le verrou optimiste.
    if (this.isFuelReportTriggerStatus(dto.status)) {
      this.dispatchDailyFuelReportRecompute(companyId, delivery.driverId, dto.status);
    }

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

    this.dataUpdateBus.emitUpdate({
      companyId,
      entity: 'delivery',
      action: dto.status,
      payload: { id },
    });

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
      } catch (err) {
        this.logger.debug(
          `Auto-geocode failed for "${delivery.deliveryAddress}" (best-effort, proof uses raw coords): ${(err as Error).message}`,
        );
      }
    }

    const distance =
      destLat != null && destLng != null
        ? Math.round(haversineDistance(dto.latitude, dto.longitude, destLat, destLng))
        : 0;
    proofData.deliveryProofDistance = distance;

    const threshold = this.configService.get<number>('LOCATION_MISMATCH_THRESHOLD_M', 200);
    let mismatch = distance > threshold;
    // Distance effective signalée (destination OU trace GPS — celle qui a déclenché).
    let mismatchDistance = distance;

    // CROSS-CHECK PREUVE vs TRACE GPS (anti-fraude à la complétion) : les coordonnées
    // de preuve envoyées par le chauffeur ne sont JAMAIS recoupées avec les positions
    // GPS réellement enregistrées pour cette livraison — un chauffeur pouvait marquer
    // « livré » depuis n'importe où en prétendant être sur place (les positions GPS
    // enregistrées par le gateway prouvent le contraire). On compare la preuve à la
    // DERNIÈRE position non suspecte de la livraison (fenêtre récente) : si elle est
    // trop éloignée, c'est une incohérence à signaler (même flag locationMismatch,
    // résolu par l'admin via resolve-mismatch). Si la trace GPS est absente ou trop
    // ancienne, on ne bloque pas (pas de preuve → pas d'accusation) mais on le signale
    // en log pour l'audit terrain.
    try {
      const gpsWindow = Number(this.configService.get<string>('GPS_PROOF_WINDOW_MIN', '30')) || 30;
      const lastGps = await this.prisma.gpsPosition.findFirst({
        where: {
          deliveryId: delivery.id,
          suspect: false,
          timestamp: { gte: new Date(Date.now() - gpsWindow * 60 * 1000) },
        },
        orderBy: { timestamp: 'desc' },
        select: { latitude: true, longitude: true, timestamp: true },
      });
      if (lastGps) {
        const gpsDistance = Math.round(
          haversineDistance(dto.latitude, dto.longitude, lastGps.latitude, lastGps.longitude),
        );
        if (gpsDistance > threshold) {
          mismatch = true;
          mismatchDistance = gpsDistance;
          this.logger.warn(
            `Delivery ${delivery.id}: proof ${dto.latitude.toFixed(6)},${dto.longitude.toFixed(6)} is ${gpsDistance}m from last GPS fix ${lastGps.latitude.toFixed(6)},${lastGps.longitude.toFixed(6)} (${lastGps.timestamp.toISOString()}) — mismatch`,
          );
        }
      } else {
        this.logger.warn(
          `Delivery ${delivery.id}: no recent non-suspect GPS position for this delivery — proof not cross-checked`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`Delivery ${delivery.id}: GPS cross-check failed — ${err?.message}`);
    }

    if (mismatch) {
      proofData.locationMismatch = true;
      proofData.mismatchResolved = false;

      await this.notifications.create(companyId, {
        type: NotificationType.location_mismatch,
        priority: NotificationPriority.high,
        title: t('delivery.notification.mismatchTitle', lang),
        message: t('delivery.notification.mismatchMessage', lang, {
          title: delivery.title,
          distance: (mismatchDistance / 1000).toFixed(1),
          meters: mismatchDistance,
        }),
        link: `/deliveries/${delivery.id}`,
        deliveryId: delivery.id,
      });
    } else {
      proofData.locationMismatch = false;
      proofData.mismatchResolved = false;
    }

    return proofData;
  }

  private async dispatchWebhook(companyId: string, delivery: any, status: DeliveryStatus) {
    // try/catch défensif : un webhook (ou sa persistance) ne doit JAMAIS faire échouer
    // la transition de livraison déjà committée (WebhooksService.dispatch est déjà
    // non-bloquant, ce garde couvre les erreurs inattendues de l'appel lui-même).
    try {
      await this.webhooks.dispatch('delivery.status_changed', companyId, {
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
        await this.webhooks.dispatch('delivery.delivered', companyId, {
          deliveryId: delivery.id,
          companyId,
          title: delivery.title,
          completedAt: new Date().toISOString(),
          deliveryAddress: delivery.deliveryAddress,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Webhook dispatch failed for delivery ${delivery.id}: ${err?.message}`);
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

  async bulkAction(
    companyId: string,
    dto: { ids: string[]; action: string; status?: string; driverId?: string },
  ): Promise<{
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
            result.failed.push({
              id,
              reason: `Transition ${delivery.status} → ${targetStatus} not allowed`,
            });
            continue;
          }
          const updateData: any = { status: targetStatus };
          if (this.isFuelReportTriggerStatus(targetStatus)) {
            if (targetStatus === DeliveryStatus.delivered) {
              updateData.completedAt = new Date();
            }
            this.dispatchDailyFuelReportRecompute(companyId, delivery.driverId, targetStatus);
          }
          await this.prisma.delivery.update({ where: { id }, data: updateData });
          this.webhooks.dispatch('delivery.status_changed', companyId, {
            deliveryId: id,
            companyId,
            title: delivery.title,
            status: targetStatus,
          });
          this.dataUpdateBus.emitUpdate({
            companyId,
            entity: 'delivery',
            action: targetStatus,
            payload: { id },
          });
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
              // Purge l'ancien assignedDriverId si le nouveau chauffeur n'a pas de
              // compte (userId null) — voir update() : même règle, cohérence entre
              // affectation simple et affectation en masse.
              assignedDriverId: driver.userId ?? null,
            },
          });
          this.webhooks.dispatch('delivery.driver_assigned', companyId, {
            deliveryId: id,
            companyId,
            title: delivery.title,
            driverId: dto.driverId,
          });
          this.dataUpdateBus.emitUpdate({
            companyId,
            entity: 'delivery',
            action: 'assigned',
            payload: { id, driverId: dto.driverId },
          });
          result.succeeded.push(id);
        } else {
          result.failed.push({ id, reason: `Unknown action: ${dto.action}` });
        }
      } catch (err: any) {
        result.failed.push({ id, reason: err.message || 'Internal error' });
      }
    }

    Logger.log(
      `Bulk action "${dto.action}": ${result.succeeded.length} succeeded, ${result.failed.length} failed`,
      'DeliveriesService',
    );
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
      const notes =
        [notesExistantes, observation ? `Observation: ${observation}` : null]
          .filter(Boolean)
          .join('\n') || undefined;

      if (existing) {
        if (mode === 'create-only') {
          result.skipped.push({ row: rowNum, orderRef, reason: 'duplicate' });
          continue;
        }
        // upsert mode: update fields but NEVER regress a status that has progressed beyond in_progress
        // (delivered, failed, cancelled) — those terminal states must stay unchanged. Une livraison
        // encore pending/assigned est AVANCÉE à in_progress à la réimportation (avant, le branchement
        // `newStatus ? {} : ...` était mort : newStatus (enum) était toujours truthy → statut gelé).
        const notStarted = existing.status === 'pending' || existing.status === 'assigned';
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
          ...(notStarted ? { status: DeliveryStatus.in_progress } : {}),
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
        if (
          (err instanceof Prisma.PrismaClientKnownRequestError ||
            err?.name === 'PrismaClientKnownRequestError') &&
          err?.code === 'P2002'
        ) {
          result.skipped.push({ row: rowNum, orderRef, reason: 'duplicate' });
        } else {
          result.errors.push({
            row: rowNum,
            reason: err instanceof Error ? err.message : 'Erreur inconnue',
          });
        }
      }
    }
    Logger.log(
      `Import Excel (${mode}): ${result.created} créées, ${result.updated} mises à jour, ${result.skipped.length} ignorées, ${result.errors.length} erreurs`,
      'DeliveriesService',
    );
    return result;
  }
}
