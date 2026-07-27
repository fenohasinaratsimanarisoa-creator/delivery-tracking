import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { UpdatePositionDto } from './dto/update-position.dto';
import { haversineDistance } from '../../common/geo/geo.utils';

const TELEPORT_SPEED_THRESHOLD_MS = 55.56;
const TELEPORT_DISTANCE_THRESHOLD_M = 5000;
const TELEPORT_TIME_THRESHOLD_S = 10;
const STOP_SPEED_THRESHOLD_MS = 0.3; // ~1 km/h — seuil pour détecter l'arrêt (évite les égalités strictes sur flottants)
const SPEED_SMOOTHING_WINDOW = 5; // nombre de positions pour lisser la vitesse (ETA/réveil retard)
// Tolérance horloge réelle (pas fenêtre anti-spam). Un doublon = timestamp identique ou antérieur.
// Avec INTERVAL_FAST=3000 côté frontend, les 3s de battement passent sans être rejetées.
const DEDUP_CLOCK_SKEW_S = 1;

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  private metrics = {
    received: 0,
    saved: 0,
    deduped: 0,
    teleported: 0,
    batchSaved: 0,
    rateLimited: 0,
    lastReportTime: Date.now(),
  };

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private geofenceService: GeofenceService,
    private deliveryProximityService: DeliveryProximityService,
    private cacheService: CacheService,
    private dataUpdateBus: DataUpdateBus,
  ) {}

  getMetrics() {
    return { ...this.metrics };
  }

  async isRateLimited(driverId: string): Promise<boolean> {
    const key = `rate_limit:driver:${driverId}`;
    const existing = await this.cacheService.get<boolean>(key);
    if (existing) {
      this.metrics.rateLimited++;
      return true;
    }
    await this.cacheService.set(key, true, 1);
    return false;
  }

  logMetrics() {
    const now = Date.now();
    const elapsedMin = (now - this.metrics.lastReportTime) / 60000;
    this.logger.log(
      `[METRICS] received=${this.metrics.received} saved=${this.metrics.saved} deduped=${this.metrics.deduped} teleported=${this.metrics.teleported} batch=${this.metrics.batchSaved} rateLimited=${this.metrics.rateLimited} (last ${elapsedMin.toFixed(1)}min)`,
    );
    this.metrics = {
      received: 0,
      saved: 0,
      deduped: 0,
      teleported: 0,
      batchSaved: 0,
      rateLimited: 0,
      lastReportTime: now,
    };
  }

  async findDriverByUserId(userId: string) {
    return this.prisma.driver.findUnique({ where: { userId } });
  }

  async verifyDriverAssignment(deliveryId: string, userId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { assignedDriverId: true, driverId: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    if (delivery.assignedDriverId !== userId) {
      const driver = await this.prisma.driver.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!driver || delivery.driverId !== driver.id) {
        throw new ForbiddenException('Driver is not assigned to this delivery');
      }
    }
  }

  async getLastPosition(vehicleId: string) {
    return this.prisma.gpsPosition.findFirst({
      where: { vehicleId },
      orderBy: { timestamp: 'desc' },
      select: { id: true, latitude: true, longitude: true, timestamp: true, speed: true },
    });
  }

  async getCompanySettings(companyId: string) {
    return this.prisma.companySettings.findUnique({ where: { companyId } });
  }

  private async detectTeleportation(
    latitude: number,
    longitude: number,
    timestamp: Date,
    vehicleId: string,
    accuracy?: number,
  ): Promise<boolean> {
    const last = await this.getLastPosition(vehicleId);
    if (!last) return false;

    const timeDiffSec = (timestamp.getTime() - last.timestamp.getTime()) / 1000;
    if (timeDiffSec <= 0) {
      this.logger.warn(
        `Timestamp non croissant reçu: vehicle=${vehicleId} diff=${timeDiffSec.toFixed(1)}s — marqué suspect`,
      );
      return true;
    }

    const distance = haversineDistance(last.latitude, last.longitude, latitude, longitude);
    const speedMs = distance / timeDiffSec;

    // If accuracy is poor, the apparent teleportation could be just GPS noise
    // Scale thresholds up with accuracy
    const accuracyScale = accuracy ? Math.max(1, accuracy / 10) : 1;
    const adjustedSpeedThreshold = TELEPORT_SPEED_THRESHOLD_MS * accuracyScale;
    const adjustedDistanceThreshold = TELEPORT_DISTANCE_THRESHOLD_M * accuracyScale;

    if (speedMs > adjustedSpeedThreshold) {
      this.logger.warn(
        `Teleportation suspect: vehicle=${vehicleId} distance=${Math.round(distance)}m time=${timeDiffSec.toFixed(1)}s speed=${(speedMs * 3.6).toFixed(1)}km/h acc=${accuracy ?? 'N/A'}`,
      );
      return true;
    }

    if (distance > adjustedDistanceThreshold && timeDiffSec < TELEPORT_TIME_THRESHOLD_S) {
      this.logger.warn(
        `Teleportation suspect (short burst): vehicle=${vehicleId} distance=${Math.round(distance)}m time=${timeDiffSec.toFixed(1)}s acc=${accuracy ?? 'N/A'}`,
      );
      return true;
    }

    return false;
  }

  private async getAverageSpeed(vehicleId: string, deliveryId: string): Promise<number | null> {
    const positions = await this.prisma.gpsPosition.findMany({
      where: { vehicleId, deliveryId },
      orderBy: { timestamp: 'desc' },
      take: SPEED_SMOOTHING_WINDOW,
      select: { speed: true },
    });
    const speeds = positions.map((p) => p.speed).filter((s): s is number => s !== null);
    if (speeds.length === 0) return null;
    return speeds.reduce((a, b) => a + b, 0) / speeds.length;
  }

  private async isDuplicateByTimestamp(
    vehicleId: string,
    deliveryId: string | undefined,
    timestamp: Date,
  ): Promise<boolean> {
    const where: { vehicleId: string; deliveryId?: string } = { vehicleId };
    if (deliveryId) {
      where.deliveryId = deliveryId;
    }
    const last = await this.prisma.gpsPosition.findFirst({
      where,
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    });
    if (!last) return false;

    const diffMs = timestamp.getTime() - last.timestamp.getTime();
    return diffMs <= DEDUP_CLOCK_SKEW_S * 1000;
  }

  private async generateAlerts(
    dto: UpdatePositionDto,
    companyId: string,
    driverId: string,
    savedPosition: { id: string; suspect: boolean },
  ) {
    const settings = await this.getCompanySettings(companyId);
    if (!settings) return;

    const tasks: Promise<unknown>[] = [];

    if (dto.speed !== undefined && settings.speedAlertThreshold) {
      const speedKmh = dto.speed * 3.6;
      if (speedKmh > settings.speedAlertThreshold) {
        const cooldownKey = `speed_alert:${dto.vehicleId}`;
        const existing = await this.cacheService.get<boolean>(cooldownKey);
        if (!existing) {
          await this.cacheService.set(cooldownKey, true, 300);
          tasks.push(
            this.notifications.create(companyId, {
              type: NotificationType.speed_alert,
              priority: NotificationPriority.high,
              title: 'Speed Alert',
              message: `Vehicle exceeded ${settings.speedAlertThreshold} km/h (${Math.round(speedKmh)} km/h)`,
              link: `/tracking/${dto.deliveryId}`,
              deliveryId: dto.deliveryId,
            }),
          );
        }
      }
    }

    if (
      settings.prolongedStopMinutes &&
      dto.speed !== undefined &&
      dto.speed < STOP_SPEED_THRESHOLD_MS
    ) {
      const lastPos = await this.getLastPosition(dto.vehicleId);
      if (lastPos && lastPos.speed !== null && lastPos.speed < STOP_SPEED_THRESHOLD_MS) {
        const stoppedMs = new Date(dto.timestamp).getTime() - new Date(lastPos.timestamp).getTime();
        const stoppedMin = stoppedMs / 60000;
        if (stoppedMin >= settings.prolongedStopMinutes) {
          tasks.push(
            this.notifications.create(companyId, {
              type: NotificationType.prolonged_stop,
              priority: NotificationPriority.medium,
              title: 'Prolonged Stop',
              message: `Vehicle stopped for ${Math.round(stoppedMin)} minutes`,
              link: `/tracking/${dto.deliveryId}`,
              deliveryId: dto.deliveryId,
            }),
          );
        }
      }
    }

    if (dto.speed !== undefined && dto.speed > 0) {
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: dto.deliveryId },
        select: { scheduledDate: true, deliveryLat: true, deliveryLng: true },
      });
      if (delivery?.deliveryLat && delivery?.deliveryLng && delivery?.scheduledDate) {
        const distanceRemaining = haversineDistance(
          dto.latitude,
          dto.longitude,
          delivery.deliveryLat,
          delivery.deliveryLng,
        );
        // Use smoothed average speed over last N positions to avoid false delay alerts
        // on momentary slowdowns (traffic light, yield)
        const avgSpeedMs = dto.deliveryId ? await this.getAverageSpeed(dto.vehicleId, dto.deliveryId) : null;
        const effectiveSpeed = avgSpeedMs ?? dto.speed;
        if (effectiveSpeed > 0) {
          const etaSec = distanceRemaining / effectiveSpeed;
          const etaDate = new Date(new Date(dto.timestamp).getTime() + etaSec * 1000);
          if (etaDate > delivery.scheduledDate) {
            const delayMin = Math.round(
              (etaDate.getTime() - delivery.scheduledDate.getTime()) / 60000,
            );
            tasks.push(
              this.notifications.create(companyId, {
                type: NotificationType.delay_alert,
                priority: NotificationPriority.high,
                title: 'Delay Alert',
                message: `Estimated arrival ${delayMin} min late (scheduled: ${delivery.scheduledDate.toLocaleString()})`,
                link: `/tracking/${dto.deliveryId}`,
                deliveryId: dto.deliveryId ?? undefined,
              }),
            );
          }
        }
      }
    }

    const lastPos = await this.getLastPosition(dto.vehicleId);
    if (lastPos && settings.offlineTimeoutMinutes) {
      const gapMs = new Date(dto.timestamp).getTime() - lastPos.timestamp.getTime();
      const gapMin = gapMs / 60000;
      if (gapMin > settings.offlineTimeoutMinutes && dto.speed !== undefined) {
        tasks.push(
          this.notifications.create(companyId, {
            type: NotificationType.device_offline,
            priority: NotificationPriority.medium,
            title: 'Device Offline',
            message: `Vehicle signal lost for ${Math.round(gapMin)} minutes — now reconnected`,
            link: `/tracking/${dto.deliveryId}`,
            deliveryId: dto.deliveryId,
          }),
        );
      }
    }

    const geofenceEvents = dto.deliveryId
      ? await this.geofenceService.checkGeofences(
          dto.deliveryId,
          dto.vehicleId,
          dto.latitude,
          dto.longitude,
        )
      : [];
    for (const geofenceEvent of geofenceEvents) {
      tasks.push(
        this.notifications.create(companyId, {
          type: NotificationType.geofence_event,
          priority: NotificationPriority.high,
          title: `Geofence ${geofenceEvent.event === 'entry' ? 'Entry' : 'Exit'}`,
          message: `Vehicle ${geofenceEvent.event === 'entry' ? 'entered' : 'exited'} "${geofenceEvent.geofenceName}"`,
          link: `/tracking/${dto.deliveryId}`,
          deliveryId: dto.deliveryId,
        }),
      );
      this.dataUpdateBus.emit('dataUpdate', {
        companyId,
        entity: 'geofence_event',
        action: geofenceEvent.event,
        payload: {
          event: geofenceEvent.event,
          geofenceId: geofenceEvent.geofenceId,
          geofenceName: geofenceEvent.geofenceName,
          deliveryId: dto.deliveryId,
          vehicleId: dto.vehicleId,
          driverId,
        },
      });
    }

    await Promise.allSettled(tasks);
  }

  /**
   * Sauvegarde une position GPS brute.
   *
   * ATTENTION : Cette méthode reçoit des coordonnées GPS brutes non filtrées.
   * Le filtre de Kalman côté frontend (KalmanFilter.ts) lisse uniquement l'affichage client.
   * Toute logique métier (téléportation, alertes, géofences) doit s'appuyer sur les données
   * brutes reçues ici, pas sur des coordonnées filtrées.
   */
  async savePosition(driverId: string, dto: UpdatePositionDto, companyId?: string) {
    this.metrics.received++;

    if (!dto.vehicleId || dto.vehicleId.length < 16) {
      this.logger.error(
        `savePosition rejected: invalid vehicleId="${dto.vehicleId}" — must be a valid UUIDv4`,
      );
      return null;
    }
    if (dto.deliveryId !== undefined && dto.deliveryId !== null && dto.deliveryId.length < 16) {
      this.logger.error(
        `savePosition rejected: invalid deliveryId="${dto.deliveryId}" — must be a valid UUIDv4`,
      );
      return null;
    }

    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: dto.vehicleId },
      select: { companyId: true },
    });
    if (!vehicle) {
      this.logger.warn(
        `savePosition rejected: vehicle ${dto.vehicleId} not found (driverId=${driverId})`,
      );
      return null;
    }
    if (companyId && vehicle.companyId !== companyId) {
      this.logger.warn(
        `Cross-tenant position rejected: vehicle ${dto.vehicleId} belongs to company ${vehicle.companyId}, not ${companyId} (driverId=${driverId})`,
      );
      return null;
    }

    const ts = new Date(dto.timestamp);

    const isDup = await this.isDuplicateByTimestamp(dto.vehicleId, dto.deliveryId, ts);
    if (isDup) {
      this.metrics.deduped++;
      this.logger.debug(
        `Duplicate position rejected (timestamp window): vehicle=${dto.vehicleId} ts=${dto.timestamp}`,
      );
      return null;
    }

    const suspect = await this.detectTeleportation(
      dto.latitude,
      dto.longitude,
      ts,
      dto.vehicleId,
      dto.accuracy,
    );
    if (suspect) this.metrics.teleported++;

    const locationStr = `POINT(${dto.longitude} ${dto.latitude})`;

    const saved = await this.prisma.gpsPosition.create({
      data: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: dto.speed,
        heading: dto.heading,
        altitude: dto.altitude,
        accuracy: dto.accuracy,
        suspect,
        location: locationStr,
        timestamp: ts,
        deliveryId: dto.deliveryId,
        vehicleId: dto.vehicleId,
        driverId,
      },
    });

    this.metrics.saved++;

    if (this.metrics.received % 100 === 0) {
      this.logMetrics();
    }

    if (companyId && !suspect) {
      this.generateAlerts(dto, companyId, driverId, saved).catch((err) =>
        this.logger.error(`Alert generation failed: ${err}`),
      );
    }

    if (companyId) {
      this.deliveryProximityService
        .checkProximity(driverId, dto.vehicleId, companyId, dto.latitude, dto.longitude, ts)
        .catch((err) => this.logger.error(`Proximity check failed: ${err}`));
    }

    return saved;
  }

  async saveBatch(
    userId: string,
    driverId: string,
    positions: UpdatePositionDto[],
    companyId?: string,
  ) {
    const saved: any[] = [];

    const deliveryIds = [...new Set(positions.map((p) => p.deliveryId).filter((x): x is string => !!x))];
    const verifiedDeliveries = new Set<string>();
    if (deliveryIds.length > 0) {
      const validDeliveries = await this.prisma.delivery.findMany({
        where: { id: { in: deliveryIds }, assignedDriverId: userId, deletedAt: null },
        select: { id: true },
      });
      validDeliveries.forEach((d) => verifiedDeliveries.add(d.id));
    }

    for (const pos of positions) {
      try {
        if (pos.deliveryId && !verifiedDeliveries.has(pos.deliveryId)) {
          this.logger.warn(
            `Batch position rejected (wrong driver): delivery=${pos.deliveryId} driver=${driverId}`,
          );
          continue;
        }
      } catch {
        this.logger.warn(
          `Batch position rejected (wrong driver): delivery=${pos.deliveryId} driver=${driverId}`,
        );
        continue;
      }
      const result = await this.savePosition(driverId, pos, companyId);
      if (result) saved.push(result);
    }
    return saved;
  }

  async getPositionsByDelivery(deliveryId: string, companyId: string, page = 1, limit = 200) {
    const skip = (page - 1) * limit;
    const where = { deliveryId, delivery: { companyId } };
    const [data, total] = await Promise.all([
      this.prisma.gpsPosition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { timestamp: 'asc' },
        select: {
          id: true,
          latitude: true,
          longitude: true,
          speed: true,
          heading: true,
          altitude: true,
          accuracy: true,
          suspect: true,
          timestamp: true,
          driverId: true,
        },
      }),
      this.prisma.gpsPosition.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getAllPositionsByDelivery(deliveryId: string, companyId: string) {
    return this.prisma.gpsPosition.findMany({
      where: { deliveryId, delivery: { companyId } },
      orderBy: { timestamp: 'asc' },
      take: 10000,
    });
  }

  async getDeliveryInfo(deliveryId: string, companyId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, companyId },
      select: {
        id: true,
        title: true,
        status: true,
        pickupAddress: true,
        deliveryAddress: true,
        pickupLat: true,
        pickupLng: true,
        deliveryLat: true,
        deliveryLng: true,
        scheduledDate: true,
        publicTrackingRevokedAt: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  async calculateDistance(
    deliveryId: string,
    companyId: string,
  ): Promise<{ meters: number; kilometers: number }> {
    const positions = await this.getAllPositionsByDelivery(deliveryId, companyId);
    if (positions.length < 2) return { meters: 0, kilometers: 0 };

    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
      totalDistance += haversineDistance(
        positions[i - 1].latitude,
        positions[i - 1].longitude,
        positions[i].latitude,
        positions[i].longitude,
      );
    }
    return {
      meters: Math.round(totalDistance),
      kilometers: Math.round(totalDistance / 10) / 100,
    };
  }

  async revokePublicToken(deliveryId: string, companyId: string): Promise<void> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, companyId },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    await this.prisma.delivery.update({
      where: { id: deliveryId },
      data: { publicTrackingRevokedAt: new Date() },
    });
  }

  async getLastPositionByTraccarId(traccarDeviceId: string) {
    return this.prisma.gpsPosition.findFirst({
      where: { vehicle: { traccarDeviceId } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, latitude: true, longitude: true },
    });
  }

  async linkVehicleToTraccar(vehicleId: string, companyId: string, traccarDeviceId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        traccarDeviceId,
        positionSource: 'physical_tracker',
      },
      select: { id: true, brand: true, model: true, licensePlate: true, traccarDeviceId: true, positionSource: true },
    });
  }

  async getStatus() {
    return { status: 'ok', service: 'tracking' };
  }

  async getTripReport(deliveryId: string, companyId: string) {
    const positions = await this.getAllPositionsByDelivery(deliveryId, companyId);
    const delivery = await this.getDeliveryInfo(deliveryId, companyId);

    if (positions.length === 0) {
      return {
        delivery,
        totalDistance: { meters: 0, kilometers: 0 },
        avgSpeedKmh: 0,
        totalDurationSec: 0,
        stopCount: 0,
        positionCount: 0,
        postgisDistance: { meters: 0, kilometers: 0 },
      };
    }

    const totalDistance = await this.calculateDistance(deliveryId, companyId);

    let postgisDistance: { meters: number; kilometers: number } | null = null;
    try {
      postgisDistance = await this.calculateDistancePostGIS(deliveryId, companyId);
    } catch {
      postgisDistance = totalDistance;
    }

    const first = positions[0];
    const last = positions[positions.length - 1];
    const durationMs = last.timestamp.getTime() - first.timestamp.getTime();
    const totalDurationSec = Math.round(durationMs / 1000);

    const speeds = positions.map((p) => p.speed ?? 0);
    const avgSpeedMs = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const avgSpeedKmh = Math.round(avgSpeedMs * 3.6 * 10) / 10;

    let stopCount = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      if (prev.speed === null || curr.speed === null) continue;
      if (prev.speed < STOP_SPEED_THRESHOLD_MS && curr.speed >= STOP_SPEED_THRESHOLD_MS) {
        stopCount++;
      }
    }

    return {
      delivery,
      totalDistance,
      avgSpeedKmh,
      totalDurationSec,
      stopCount,
      positionCount: positions.length,
      postgisDistance,
    };
  }

  async calculateDistancePostGIS(
    deliveryId: string,
    companyId: string,
  ): Promise<{ meters: number; kilometers: number }> {
    const raw = await this.prisma.$queryRaw<Array<{ total_meters: number }>>`
      SELECT COALESCE(SUM(
        ST_DistanceSphere(
          ST_MakePoint(gp.longitude, gp.latitude),
          ST_MakePoint(
            LAG(gp.longitude) OVER (ORDER BY gp.timestamp),
            LAG(gp.latitude) OVER (ORDER BY gp.timestamp)
          )
        )
      ), 0) AS total_meters
      FROM gps_positions gp
      JOIN deliveries d ON d.id = gp.delivery_id
      WHERE gp.delivery_id = CAST(${deliveryId} AS uuid)
        AND d.company_id = CAST(${companyId} AS uuid)
      ORDER BY gp.timestamp
    `;
    const meters = Math.round(raw[0]?.total_meters ?? 0);
    return {
      meters,
      kilometers: Math.round(meters / 10) / 100,
    };
  }

  async getLivePositions(companyId: string) {
    const positions = await this.prisma.$queryRaw<Array<{
      driver_id: string;
      driver_first_name: string;
      driver_last_name: string;
      latitude: number;
      longitude: number;
      speed: number | null;
      heading: number | null;
      accuracy: number | null;
      timestamp: Date;
      vehicle_id: string;
      delivery_id: string | null;
      minutes_ago: number;
    }>>`
      SELECT DISTINCT ON (gp.vehicle_id)
        gp.driver_id,
        d.first_name AS driver_first_name,
        d.last_name AS driver_last_name,
        gp.latitude,
        gp.longitude,
        gp.speed,
        gp.heading,
        gp.accuracy,
        gp.timestamp,
        gp.vehicle_id,
        gp.delivery_id,
        EXTRACT(EPOCH FROM (NOW() - gp.timestamp)) / 60 AS minutes_ago
      FROM gps_positions gp
      JOIN drivers d ON d.id = gp.driver_id
      JOIN vehicles v ON v.id = gp.vehicle_id AND v.deleted_at IS NULL AND v.is_active = true
      WHERE d.company_id = CAST(${companyId} AS uuid)
        AND d.deleted_at IS NULL
        AND d.is_active = true
      ORDER BY gp.vehicle_id, gp.timestamp DESC
    `;
    return positions.map((p) => ({
      driverId: p.driver_id,
      driverName: `${p.driver_first_name} ${p.driver_last_name}`,
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed,
      heading: p.heading,
      accuracy: p.accuracy,
      timestamp: p.timestamp,
      vehicleId: p.vehicle_id,
      deliveryId: p.delivery_id,
      minutesAgo: Number(p.minutes_ago),
    }));
  }

  async findNearestVehicle(lat: number, lng: number, companyId: string) {
    const raw = await this.prisma.$queryRaw<Array<{ vehicle_id: string; distance_meters: number }>>`
      SELECT
        gp.vehicle_id,
        MIN(ST_DistanceSphere(ST_MakePoint(gp.longitude, gp.latitude), ST_MakePoint(${lng}, ${lat}))) AS distance_meters
      FROM gps_positions gp
      JOIN deliveries d ON d.id = gp.delivery_id AND d.company_id = CAST(${companyId} AS uuid)
      WHERE gp.timestamp >= NOW() - INTERVAL '15 minutes'
      GROUP BY gp.vehicle_id
      ORDER BY distance_meters ASC
      LIMIT 1
    `;
    return raw[0] ?? null;
  }

  /**
   * Archives (deletes + moves to archive table) positions OLDER than `date`
   * across ALL companies. For company-scoped archiving, use
   * {@link archivePositionsBefore} instead.
   */
  async archiveAllCompaniesPositionsBefore(date: Date): Promise<number> {
    this.logger.warn('archiveAllCompaniesPositionsBefore called — this archives positions for ALL companies');
    const cutoff = date.toISOString();
    const result = await this.prisma.$executeRawUnsafe(
      `
      WITH archived AS (
        DELETE FROM gps_positions
        WHERE gps_positions.timestamp < $1::timestamp
        RETURNING gps_positions.id, gps_positions.latitude, gps_positions.longitude, gps_positions.speed, gps_positions.heading, gps_positions.altitude, gps_positions.accuracy, gps_positions.suspect, gps_positions.location, gps_positions.timestamp, gps_positions.created_at, gps_positions.delivery_id, gps_positions.vehicle_id, gps_positions.driver_id
      )
      INSERT INTO gps_positions_archive (id, latitude, longitude, speed, heading, altitude, accuracy, suspect, location, timestamp, created_at, delivery_id, vehicle_id, driver_id)
      SELECT id, latitude, longitude, speed, heading, altitude, accuracy, suspect, location, timestamp, created_at, delivery_id, vehicle_id, driver_id
      FROM archived
    `,
      cutoff,
    );
    return result;
  }

  async archivePositionsBefore(date: Date, companyId: string): Promise<number> {
    // Sécurité : n'autorise pas l'archivage de positions de moins de 48h,
    // pour laisser le temps au cron carburant (22h) + génération à la demande
    // de produire les rapports quotidiens avant que les données GPS soient purgées.
    const minAge = new Date(Date.now() - 48 * 60 * 60 * 1000);
    if (date > minAge) {
      this.logger.warn(`archivePositionsBefore refused: date ${date.toISOString()} is less than 48h old`);
      return 0;
    }
    const cutoff = date.toISOString();
    const result = await this.prisma.$executeRawUnsafe(
      `
      WITH archived AS (
        DELETE FROM gps_positions
        USING vehicles
        WHERE gps_positions.vehicle_id = vehicles.id
          AND vehicles.company_id = $2::uuid
          AND gps_positions.timestamp < $1::timestamp
        RETURNING gps_positions.id, gps_positions.latitude, gps_positions.longitude, gps_positions.speed, gps_positions.heading, gps_positions.altitude, gps_positions.accuracy, gps_positions.suspect, gps_positions.location, gps_positions.timestamp, gps_positions.created_at, gps_positions.delivery_id, gps_positions.vehicle_id, gps_positions.driver_id
      )
      INSERT INTO gps_positions_archive (id, latitude, longitude, speed, heading, altitude, accuracy, suspect, location, timestamp, created_at, delivery_id, vehicle_id, driver_id)
      SELECT id, latitude, longitude, speed, heading, altitude, accuracy, suspect, location, timestamp, created_at, delivery_id, vehicle_id, driver_id
      FROM archived
    `,
      cutoff,
      companyId,
    );
    return result;
  }

  async generateTripReportPdf(deliveryId: string, companyId: string): Promise<Buffer> {
    const report = await this.getTripReport(deliveryId, companyId);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]);
    const { width, height } = page.getSize();
    const margin = 50;
    let y = height - margin;

    const title = (text: string, size = 16) => {
      page.drawText(text, { x: margin, y, size, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 8;
    };
    const field = (label: string, value: string, size = 10) => {
      page.drawText(label, { x: margin, y, size, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(value, { x: margin + 140, y, size, font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    };

    title('Trip Report', 18);
    y -= 10;

    field('Delivery', report.delivery.title);
    field('Status', report.delivery.status);
    field('Pickup', report.delivery.pickupAddress);
    field('Dropoff', report.delivery.deliveryAddress);
    y -= 10;

    title('Stats', 14);
    y -= 4;
    field('Distance (JS)', `${report.totalDistance.kilometers} km`);
    if (report.postgisDistance) {
      field('Distance (PostGIS)', `${report.postgisDistance.kilometers} km`);
    }
    field('Avg Speed', `${report.avgSpeedKmh} km/h`);
    const mins = Math.floor(report.totalDurationSec / 60);
    const secs = report.totalDurationSec % 60;
    field('Duration', `${mins}m ${secs}s`);
    field('Stops', `${report.stopCount}`);
    field('Positions', `${report.positionCount}`);

    const buf = await doc.save();
    return Buffer.from(buf);
  }

}
