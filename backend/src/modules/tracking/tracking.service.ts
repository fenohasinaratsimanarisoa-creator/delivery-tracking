import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { UpdatePositionDto } from './dto/update-position.dto';
import {
  haversineDistance,
  GPS_NOISE_THRESHOLD_M,
  computeFilteredDistance,
} from '../../common/geo/geo.utils';
import { evaluateTeleportation } from '../../common/geo/teleportation.utils';

const STOP_SPEED_THRESHOLD_MS = 0.3; // ~1 km/h — seuil pour détecter l'arrêt (évite les égalités strictes sur flottants)
const SPEED_SMOOTHING_WINDOW = 5; // nombre de positions pour lisser la vitesse (ETA/réveil retard)
// Tolérance horloge réelle (pas fenêtre anti-spam). Un doublon = timestamp identique ou antérieur.
// Avec INTERVAL_FAST=3000 côté frontend, les 3s de battement passent sans être rejetées.
const DEDUP_CLOCK_SKEW_S = 1;

// Source d'émission d'une position GPS. Utilisée par savePosition() pour isoler
// strictement les flux : un véhicule 'physical_tracker' ne doit recevoir que des
// positions du pont Traccar (source='physical_tracker'), jamais de l'app mobile
// chauffeur (source='phone').
export type PositionSource = 'phone' | 'physical_tracker';

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
    private configService: ConfigService,
  ) {}

  getMetrics() {
    return { ...this.metrics };
  }

  async isRateLimited(driverId: string): Promise<boolean> {
    // Fenêtre anti-flood configurable (ms). 0 ou négatif = limite désactivée
    // (utilisé par les tests e2e pour exercer le flux de sauvegarde sans rejets,
    // la cadence réelle de l'app étant de ~5s par position, très en dessous du défaut 1s).
    const ttlMs = Number(this.configService.get<string>('POSITION_RATE_LIMIT_TTL_MS', '1000'));
    if (!ttlMs || ttlMs <= 0) return false;
    const key = `rate_limit:driver:${driverId}`;
    const existing = await this.cacheService.get<boolean>(key);
    if (existing) {
      this.metrics.rateLimited++;
      return true;
    }
    await this.cacheService.set(key, true, ttlMs / 1000);
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

  async assertVehicleOwnership(vehicleId: string, companyId: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found or access denied');
    }
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

  /**
   * Dernière position GPS d'un véhicule.
   *
   * @param excludeSuspect exclut les positions suspectes (suspect=true — téléportation /
   *                       bruit GPS) de la requête. Défaut TRUE : une position aberrante
   *                       ne doit jamais servir de référence fiable (ex. référence de
   *                       téléportation, inférence de vitesse). Passer false quand le
   *                       contexte veut voir la DERNIÈRE position reçue quelle qu'elle
   *                       soit (ex. détection de connectivité : un point suspect prouve
   *                       quand même que le dispositif émet).
   */
  async getLastPosition(vehicleId: string, excludeSuspect = true) {
    return this.prisma.gpsPosition.findFirst({
      where: {
        vehicleId,
        ...(excludeSuspect ? { suspect: false } : {}),
      },
      orderBy: { timestamp: 'desc' },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        timestamp: true,
        speed: true,
        source: true,
      },
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
    source?: PositionSource,
  ): Promise<boolean> {
    const last = await this.getLastPosition(vehicleId);
    if (!last) return false;

    // --- Exemption changement de source (documenté, prompt 4/4) ---
    // Le PREMIER point GPS après un basculement de source (phone → physical_tracker
    // ou l'inverse) sur un même véhicule peut légitimement représenter un vrai
    // déplacement : les deux flux ne sont pas raccordés. Le dernier point de l'AUTRE
    // source peut être vieux (le flux précédent était inactif — ex. un traceur
    // installé/activé après avoir roulé en mode phone) ou à une position très
    // différente (le véhicule a bougé pendant l'interruption). Comparer ce point au
    // dernier point de l'AUTRE source déclencherait un FAUX suspect de téléportation.
    // On compare donc uniquement AU SEIN DE LA MÊME SOURCE si un changement de source
    // a eu lieu dans les 5 dernières minutes ; sans position intra-source, le point
    // passe (aucune référence fiable pour le qualifier de téléportation). La détection
    // de téléportation n'est PAS désactivée : un vrai saut dans la même source reste
    // suspecté exactement comme avant.
    let reference: { latitude: number; longitude: number; timestamp: Date } = last;
    if (source && last.source !== undefined && last.source !== source) {
      const gapSec = (timestamp.getTime() - last.timestamp.getTime()) / 1000;
      if (gapSec > 0 && gapSec <= 300) {
        // Cohérent avec le changement de référence ci-dessus : la recherche intra-source
        // doit elle aussi ignorer les positions suspectes (un point aberrant ne peut pas
        // servir de référence fiable pour qualifier — ou absoudre — une téléportation).
        const sameSourceLast = await this.prisma.gpsPosition.findFirst({
          where: { vehicleId, source, suspect: false },
          orderBy: { timestamp: 'desc' },
          select: { latitude: true, longitude: true, timestamp: true },
        });
        if (!sameSourceLast) {
          this.logger.debug(
            `Teleportation exempted: changement de source détecté (${last.source} → ${source}) — aucun historique intra-source pour comparer`,
          );
          return false;
        }
        reference = sameSourceLast;
      }
    }

    // Décision unique partagée avec le chemin batch (evaluateTeleportation, source unique
    // dans teleportation.utils) : règles de vitesse + saut court + garde non-croissant.
    const evaluation = evaluateTeleportation(reference, latitude, longitude, timestamp, accuracy);
    if (evaluation.suspect) {
      const reasonLabel =
        evaluation.reason === 'non_croissant'
          ? 'timestamp non croissant'
          : evaluation.reason === 'saut_court'
            ? 'saut court'
            : 'vitesse';
      this.logger.warn(
        `Teleportation suspect (${reasonLabel}): vehicle=${vehicleId} distance=${Math.round(evaluation.distance)}m time=${evaluation.timeDiffSec.toFixed(1)}s speed=${(evaluation.speedMs * 3.6).toFixed(1)}km/h acc=${accuracy ?? 'N/A'}`,
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
    driverId: string | null,
    savedPosition: { id: string; suspect: boolean },
  ) {
    const settings = await this.getCompanySettings(companyId);
    if (!settings) return;

    // CRITIQUE : Notification.userId est une FK vers users.id. Les appelsants
    // (gateway, traccar-bridge, saveBatch) passent ici l'ID de la LIGNE Driver,
    // pas l'UUID utilisateur — un create avec userId=driverId lève P2003 et
    // TOUTES les alertes types (speed, stop, retard, offline, géofence) mouraient
    // silencieusement (Promise.allSettled). On résout donc l'utilisateur cible
    // UNE fois pour l'ensemble des alertes de cette position.
    let alertUserId: string | null = null;
    if (driverId) {
      const driverRow = await this.prisma.driver.findFirst({
        where: { id: driverId },
        select: { userId: true },
      });
      alertUserId = driverRow?.userId ?? null;
    }

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
              userId: alertUserId ?? undefined,
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
              userId: alertUserId ?? undefined,
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
        const avgSpeedMs = dto.deliveryId
          ? await this.getAverageSpeed(dto.vehicleId, dto.deliveryId)
          : null;
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
                userId: alertUserId ?? undefined,
              }),
            );
          }
        }
      }
    }

    // Un point suspect prouve quand même que le dispositif transmet : il ne doit PAS
    // compter comme une perte de signal (sinon un véhicule dont les dernières positions
    // sont suspectes serait déclaré "offline" à tort).
    const lastPos = await this.getLastPosition(dto.vehicleId, false);
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
            userId: alertUserId ?? undefined,
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
          userId: alertUserId ?? undefined,
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
  async savePosition(
    driverId: string | null,
    dto: UpdatePositionDto,
    companyId?: string,
    source: PositionSource = 'phone',
  ) {
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

    // Ne garde que les véhicules actifs et non soft-deletés : un véhicule désactivé
    // ou supprimé ne doit plus pouvoir stocker de positions GPS (sinon données
    // orphelines invisibles dans l'UI qui polluent la base et les métriques).
    // Alignement sur assertVehicleOwnership() + getLivePositions().
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, deletedAt: null, isActive: true },
      select: { companyId: true, positionSource: true },
    });
    if (!vehicle) {
      // Distingue dans les logs "véhicule inexistant" de "véhicule trouvé mais
      // inactif/supprimé" (utile pour le débogage terrain). Retour toujours null
      // dans les deux cas pour ne pas changer le contrat de la fonction.
      const existingVehicle = await this.prisma.vehicle.findUnique({
        where: { id: dto.vehicleId },
        select: { isActive: true, deletedAt: true },
      });
      if (!existingVehicle) {
        this.logger.warn(
          `savePosition rejected: vehicle ${dto.vehicleId} not found (driverId=${driverId})`,
        );
      } else {
        this.logger.warn(
          `savePosition rejected: vehicle ${dto.vehicleId} inactive or soft-deleted (isActive=${existingVehicle.isActive}, deletedAt=${existingVehicle.deletedAt ? 'set' : 'null'}, driverId=${driverId})`,
        );
      }
      return null;
    }
    if (companyId && vehicle.companyId !== companyId) {
      this.logger.warn(
        `Cross-tenant position rejected: vehicle ${dto.vehicleId} belongs to company ${vehicle.companyId}, not ${companyId} (driverId=${driverId})`,
      );
      return null;
    }

    // Isolation stricte des sources : un véhicule équipé d'un traceur physique
    // (positionSource='physical_tracker') ne doit recevoir que les positions du pont
    // Traccar (source='physical_tracker'). Une position envoyée par l'app mobile
    // chauffeur (source='phone') pour ce véhicule est rejetée silencieusement côté
    // serveur (log warn identifiable, pas d'erreur renvoyée au chauffeur) pour éviter
    // de mélanger deux flux GPS incohérents dans gps_positions. Aucun mode dégradé
    // légitime (traceur en panne) n'existe aujourd'hui : le blocage est strict.
    if (source === 'phone' && vehicle.positionSource === 'physical_tracker') {
      this.logger.warn(
        `Phone position rejected: vehicle ${dto.vehicleId} is a physical_tracker vehicle (positionSource=physical_tracker) — phone app stream not allowed (driverId=${driverId})`,
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
      source,
    );
    if (suspect) this.metrics.teleported++;

    const locationStr = `POINT(${dto.longitude} ${dto.latitude})`;

    const resolvedCompanyId = companyId || vehicle.companyId;

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
        companyId: resolvedCompanyId,
        deliveryId: dto.deliveryId,
        vehicleId: dto.vehicleId,
        driverId,
        source,
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

    // Cohérence avec generateAlerts() : une position jugée non fiable
    // (suspect=true — téléportation / bruit GPS) ne doit pas non plus alimenter le
    // chronomètre de proximité. Sinon un saut GPS fantôme pourrait déclencher ou
    // faire progresser l'alerte "vous êtes arrivé" alors que la position n'est pas
    // crédible. La proximité est UN calcul par-chauffeur : sans driverId (position
    // d'un véhicule sans chauffeur assigné à cet instant), on l'exclut simplement.
    if (companyId && !suspect && driverId) {
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
    const resolvedCompanyId = companyId || '';
    const toInsert: Array<{
      latitude: number;
      longitude: number;
      speed: number | undefined;
      heading: number | undefined;
      altitude: number | undefined;
      accuracy: number | undefined;
      suspect: boolean;
      location: string;
      timestamp: Date;
      companyId: string;
      deliveryId: string | null | undefined;
      vehicleId: string;
      driverId: string;
      source: 'phone';
    }> = [];

    const deliveryIds = [
      ...new Set(positions.map((p) => p.deliveryId).filter((x): x is string => !!x)),
    ];
    const verifiedDeliveries = new Set<string>();
    if (deliveryIds.length > 0) {
      // MÊME règle que verifyDriverAssignment() (chemin temps réel updatePosition) :
      // le chauffeur est accepté si assignedDriverId == userId OU si delivery.driverId
      // correspond à son record Driver. Avant, le batch n'acceptait QUE assignedDriverId
      // → une livraison assignée via le record Driver passait en temps réel mais était
      // rejetée ("wrong driver") en rattrapage réseau. Incohérence corrigée.
      const validDeliveries = await this.prisma.delivery.findMany({
        where: {
          id: { in: deliveryIds },
          deletedAt: null,
          OR: [{ assignedDriverId: userId }, { driverId }],
        },
        select: { id: true },
      });
      validDeliveries.forEach((d) => verifiedDeliveries.add(d.id));
    }

    const vehicleIds = [
      ...new Set(positions.map((p) => p.vehicleId).filter((x): x is string => !!x)),
    ];
    // Distinction des deux cas demandée par le diagnostic :
    //  - Le chargement des DERNIÈRES positions existantes (map lastPositions ci-dessous)
    //    sert UNIQUEMENT de référence pour le dédoublonnage/téléportation. Une position
    //    déjà en base pour un véhicule aujourd'hui désactivé n'est PAS une nouvelle
    //    écriture : on ne filtre donc pas lastPositions par deletedAt/isActive (le faire
    //    dégraderait la détection en supprimant une baseline légitime).
    //  - En revanche, une NOUVELLE position insérée pour un véhicule inactif/supprimé
    //    est le vrai risque de pollution. On pré-valide donc les véhicules du lot et on
    //    rejette les positions dont le véhicule n'est pas actif / est soft-deleted.
    const validVehicleIds = new Set<string>();
    if (vehicleIds.length > 0) {
      // saveBatch() est utilisé UNIQUEMENT par le flux batch de l'app mobile
      // (TrackingGateway.handleBatchPosition). Même isolation stricte que savePosition :
      // seuls les véhicules 'phone' acceptent des positions batch ; les véhicules
      // 'physical_tracker' sont gérés exclusivement par le pont Traccar.
      const vehicleWhere: any = {
        id: { in: vehicleIds },
        deletedAt: null,
        isActive: true,
        positionSource: 'phone',
      };
      if (companyId) vehicleWhere.companyId = companyId;
      const validVehicles = await this.prisma.vehicle.findMany({
        where: vehicleWhere,
        select: { id: true },
      });
      validVehicles.forEach((v) => validVehicleIds.add(v.id));
    }

    const lastPositions = new Map<
      string,
      { latitude: number; longitude: number; timestamp: Date; speed: number | null }
    >();
    if (vehicleIds.length > 0) {
      const rows = await this.prisma.gpsPosition.findMany({
        where: { vehicleId: { in: vehicleIds } },
        orderBy: { timestamp: 'desc' },
        distinct: ['vehicleId'],
        select: { vehicleId: true, latitude: true, longitude: true, timestamp: true, speed: true },
      });
      for (const row of rows) {
        lastPositions.set(row.vehicleId, row);
      }
    }

    // 1er passage : ne garder que les positions VALIDES (IDs bien formés, livraison du bon
    // chauffeur, véhicule actif). Le tri chronologique s'applique à ce sous-ensemble, pas
    // aux données qui seront de toute façon rejetées (inutile de trier du bruit).
    const validPositions: typeof positions = [];
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

      if (!pos.vehicleId || pos.vehicleId.length < 16) continue;
      if (pos.deliveryId !== undefined && pos.deliveryId !== null && pos.deliveryId.length < 16)
        continue;

      if (!validVehicleIds.has(pos.vehicleId)) {
        this.logger.warn(
          `Batch position rejected: vehicle ${pos.vehicleId} not found, inactive or soft-deleted (driver=${driverId})`,
        );
        continue;
      }

      validPositions.push(pos);
    }

    // Tri chronologique (copie) APRÈS le filtrage, AVANT tout calcul de dédoublonnage et de
    // téléportation. Le flux batchPosition (TrackingGateway.handleBatchPosition) est le
    // rattrapage réseau de l'app mobile : l'ordre d'arrivée n'est PAS garanti
    // chronologique. Sans ce tri, une position antérieure à la première traitée est rejetée
    // à tort comme doublon (timeDiffSec négatif) et les vitesses entre points non-consécutifs
    // deviennent absurdes (>200 km/h) — ce qui polluait suspect et, en aval, les distances
    // carburant (filtres suspect=false). verifiedDeliveries/validVehicleIds sont des Set
    // indépendants de l'ordre (aucune casse de correspondance). Cas limite : deux positions
    // au timestamp STRICTEMENT identique — le tri les conserve toutes les deux ; la 2e est
    // rejetée par le dédoublonnage timeDiffSec <= DEDUP_CLOCK_SKEW_S, même fenêtre de 1s que
    // isDuplicateByTimestamp du chemin temps réel (comportement cohérent, pas de doublon).
    const sorted = [...validPositions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    for (const pos of sorted) {
      const ts = new Date(pos.timestamp);
      const last = lastPositions.get(pos.vehicleId);

      const timeDiffSec = last ? (ts.getTime() - last.timestamp.getTime()) / 1000 : Infinity;

      if (timeDiffSec <= DEDUP_CLOCK_SKEW_S) {
        this.metrics.deduped++;
        this.logger.debug(
          `Batch duplicate rejected (timestamp): vehicle=${pos.vehicleId} ts=${pos.timestamp}`,
        );
        continue;
      }

      // NOUVEAU : vitesse de secours si le device n'a pas fourni pos.speed (cas de la
      // file offline flushée après une coupure réseau / passage en arrière-plan). Même
      // fallback que le chemin temps réel (tracking.gateway) : haversine(distance)/Δt
      // contre la dernière position (lastPositions, maintenue ci-dessous). Sans cela, la
      // RÈGLE VITESSE du rapport carburant (computeFilteredDistance) retombait sur le
      // filtre accuracy quand speed restait null en base → sous-comptage de la distance.
      // Calculé APRÈS le dédoublonnage (timeDiffSec > 1s garanti ici), avant/indépendamment
      // d'evaluateTeleportation qui ne doit PAS être modifié.
      let resolvedSpeed = pos.speed;
      if (
        (!resolvedSpeed || resolvedSpeed <= 0) &&
        last &&
        timeDiffSec > 0 &&
        Number.isFinite(timeDiffSec)
      ) {
        const distance = haversineDistance(
          last.latitude,
          last.longitude,
          pos.latitude,
          pos.longitude,
        );
        resolvedSpeed = distance / timeDiffSec;
      }

      let suspect = false;
      if (last && timeDiffSec > 0) {
        // Même décision de téléportation que le chemin temps réel (evaluateTeleportation,
        // source unique dans teleportation.utils) : règle de vitesse + saut court. Les
        // timestamps non croissants / dans la fenêtre 1s ont déjà été rejetés par le
        // dédoublonnage ci-dessus (politique documentée, identique au temps réel). Un point
        // suspect est SAUVEGARDÉ avec suspect=true (traçabilité conservée pour l'audit).
        suspect = evaluateTeleportation(
          last,
          pos.latitude,
          pos.longitude,
          ts,
          pos.accuracy,
        ).suspect;
        if (suspect) this.metrics.teleported++;
      }

      lastPositions.set(pos.vehicleId, {
        latitude: pos.latitude,
        longitude: pos.longitude,
        timestamp: ts,
        speed: resolvedSpeed ?? null,
      });

      toInsert.push({
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: resolvedSpeed,
        heading: pos.heading,
        altitude: pos.altitude,
        accuracy: pos.accuracy,
        suspect,
        location: `POINT(${pos.longitude} ${pos.latitude})`,
        timestamp: ts,
        companyId: resolvedCompanyId,
        deliveryId: pos.deliveryId,
        vehicleId: pos.vehicleId,
        driverId,
        source: 'phone',
      });
    }

    if (toInsert.length === 0) return saved;

    this.metrics.batchSaved += toInsert.length;

    // createManyAndReturn (au lieu de createMany + findMany ré-fetch) : sous charge,
    // les lignes du lot étaient re-cherchées par (vehicleId, timestamp, driverId) —
    // un autre batch concurrent, ou les positions temps réel du même véhicule,
    // pouvaient échanger des timestamps entre l'INSERT et la SELECT (timestamps
    // identiques sur le même véhicule), faussant l'ordre, voire omettant des lignes.
    const inserted = await this.prisma.gpsPosition.createManyAndReturn({
      data: toInsert,
      skipDuplicates: false,
    });

    this.metrics.saved += inserted.length;

    for (const record of inserted) {
      saved.push(record);
      if (companyId && !record.suspect) {
        this.generateAlerts(
          {
            vehicleId: record.vehicleId,
            deliveryId: record.deliveryId ?? undefined,
            latitude: record.latitude,
            longitude: record.longitude,
            speed: record.speed ?? undefined,
            heading: record.heading ?? undefined,
            altitude: record.altitude ?? undefined,
            accuracy: record.accuracy ?? undefined,
            timestamp: record.timestamp.toISOString(),
          },
          companyId,
          driverId,
          record,
        ).catch((err) => this.logger.error(`Alert generation failed: ${err}`));
      }
    }

    if (companyId && inserted.length > 0) {
      const last = inserted[inserted.length - 1];
      this.deliveryProximityService
        .checkProximity(
          driverId,
          last.vehicleId,
          companyId,
          last.latitude,
          last.longitude,
          last.timestamp,
        )
        .catch((err) => this.logger.error(`Proximity check failed: ${err}`));
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

  /**
   * Positions d'une livraison.
   *
   * @param excludeSuspect exclut les positions suspectes (suspect=true — téléportation /
   *                       bruit GPS) de la requête. Défaut TRUE : changement de comportement
   *                       assumé — le rapport de trajet (PDF/dispatcher) doit désormais
   *                       matcher le rapport carburant (generateDailyReportForDriver), qui
   *                       filtre suspect=false par défaut. Passer false pour récupérer la
   *                       trace brute complète (ex. carte live publique).
   */
  async getAllPositionsByDelivery(deliveryId: string, companyId: string, excludeSuspect = true) {
    const where = {
      deliveryId,
      delivery: { companyId },
      ...(excludeSuspect ? { suspect: false } : {}),
    };
    const total = await this.prisma.gpsPosition.count({ where });
    if (total > 10000) {
      this.logger.warn(`Delivery ${deliveryId} has ${total} positions — truncating to 10000`);
    }
    return this.prisma.gpsPosition.findMany({
      where,
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

    // Même logique de distance filtrée que le rapport carburant (computeFilteredDistance,
    // source unique dans geo.utils) : les segments < seuil de bruit PONDÉRÉ PAR l'accuracy
    // moyenne du segment (dérive GPS à l'arrêt, accuracy 10-50m) ne sont PAS comptés. Sans
    // cette pondération, le rapport de trajet gonflait la distance par rapport au
    // DailyFuelReport pour le même trajet.
    const totalDistance = computeFilteredDistance(positions);
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

  async getLastPositionByTraccarId(traccarDeviceId: string, companyId: string) {
    return this.prisma.gpsPosition.findFirst({
      where: { vehicle: { traccarDeviceId, companyId } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, latitude: true, longitude: true },
    });
  }

  async linkVehicleToTraccar(vehicleId: string, companyId: string, traccarDeviceId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');

    const otherVehicle = await this.prisma.vehicle.findFirst({
      where: {
        traccarDeviceId,
        isActive: true,
        deletedAt: null,
        id: { not: vehicleId },
      },
    });
    if (otherVehicle) {
      throw new ConflictException(
        `traccarDeviceId "${traccarDeviceId}" is already assigned to another active vehicle`,
      );
    }

    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        traccarDeviceId,
        positionSource: 'physical_tracker',
      },
      select: {
        id: true,
        brand: true,
        model: true,
        licensePlate: true,
        traccarDeviceId: true,
        positionSource: true,
      },
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
    // Mêmes filtres que calculateDistance()/generateDailyReportForDriver() :
    //  - suspect=false exclu dans le WHERE du sous-select (les points suspects sont
    //    entièrement écartés du fenêtrage LAG) ;
    //  - seuil de bruit GPS (< GPS_NOISE_THRESHOLD_M m) appliqué en CASE WHEN sur la
    //    distance de chaque paire LAG, dans la SELECT AGRÉGANTE (après le calcul LAG
    //    par-paire) : un point de bruit reste dans la fenêtre LAG, sinon le segment
    //    suivant sauterait un point et sur-évaluerait la distance entre points
    //    non-consécutifs.
    // NOTE : LAG (window function) ne peut pas être imbriqué dans un agrégat — on
    // calcule les distances par-paire dans un sous-select puis on agrège au-dessus.
    const raw = await this.prisma.$queryRaw<Array<{ total_meters: number }>>`
      SELECT COALESCE(SUM(
        CASE
          WHEN seg_distance < ${GPS_NOISE_THRESHOLD_M} THEN 0
          ELSE seg_distance
        END
      ), 0) AS total_meters
      FROM (
        SELECT ST_DistanceSphere(
          ST_MakePoint(gp.longitude, gp.latitude),
          ST_MakePoint(
            LAG(gp.longitude) OVER (ORDER BY gp.timestamp),
            LAG(gp.latitude) OVER (ORDER BY gp.timestamp)
          )
        ) AS seg_distance
        FROM gps_positions gp
        JOIN deliveries d ON d.id = gp.delivery_id
        WHERE gp.delivery_id = CAST(${deliveryId} AS uuid)
          AND d.company_id = CAST(${companyId} AS uuid)
          AND gp.suspect = false
      ) sub
    `;
    const meters = Math.round(raw[0]?.total_meters ?? 0);
    return {
      meters,
      kilometers: Math.round(meters / 10) / 100,
    };
  }

  async getLivePositions(companyId: string) {
    const positions = await this.prisma.$queryRaw<
      Array<{
        driver_id: string | null;
        driver_first_name: string | null;
        driver_last_name: string | null;
        latitude: number;
        longitude: number;
        speed: number | null;
        heading: number | null;
        accuracy: number | null;
        suspect: boolean;
        timestamp: Date;
        vehicle_id: string;
        delivery_id: string | null;
        minutes_ago: number;
      }>
    >`
      SELECT DISTINCT ON (gp.vehicle_id)
        gp.driver_id,
        d.first_name AS driver_first_name,
        d.last_name AS driver_last_name,
        gp.latitude,
        gp.longitude,
        gp.speed,
        gp.heading,
        gp.accuracy,
        gp.suspect,
        gp.timestamp,
        gp.vehicle_id,
        gp.delivery_id,
        EXTRACT(EPOCH FROM (NOW() - gp.timestamp)) / 60 AS minutes_ago
      FROM gps_positions gp
      LEFT JOIN drivers d ON d.id = gp.driver_id AND d.deleted_at IS NULL AND d.is_active = true
      JOIN vehicles v ON v.id = gp.vehicle_id AND v.deleted_at IS NULL AND v.is_active = true
      WHERE v.company_id = CAST(${companyId} AS uuid)
      ORDER BY gp.vehicle_id, gp.timestamp DESC
    `;
    return positions.map((p) => ({
      driverId: p.driver_id,
      driverName:
        p.driver_id == null || !p.driver_first_name || !p.driver_last_name
          ? 'Véhicule sans chauffeur assigné'
          : `${p.driver_first_name} ${p.driver_last_name}`,
      latitude: p.latitude,
      longitude: p.longitude,
      speed: p.speed,
      heading: p.heading,
      accuracy: p.accuracy,
      suspect: p.suspect,
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
      JOIN vehicles v ON v.id = gp.vehicle_id AND v.company_id = CAST(${companyId} AS uuid) AND v.deleted_at IS NULL AND v.is_active = true
      WHERE gp.suspect = false
        AND gp.timestamp >= NOW() - INTERVAL '15 minutes'
        AND gp.vehicle_id NOT IN (
          SELECT d2.vehicle_id FROM deliveries d2
          WHERE d2.company_id = CAST(${companyId} AS uuid)
            AND d2.deleted_at IS NULL
            AND d2.status IN ('assigned', 'in_progress')
            AND d2.vehicle_id IS NOT NULL
        )
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
    this.logger.warn(
      'archiveAllCompaniesPositionsBefore called — this archives positions for ALL companies',
    );
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
      this.logger.warn(
        `archivePositionsBefore refused: date ${date.toISOString()} is less than 48h old`,
      );
      return 0;
    }
    const cutoff = date.toISOString();
    const result = await this.prisma.$executeRawUnsafe(
      `
      WITH archived AS (
        DELETE FROM gps_positions
        WHERE gps_positions.company_id = $2::uuid
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
