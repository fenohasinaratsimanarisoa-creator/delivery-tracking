import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  NotificationType,
  NotificationPriority,
  Prisma,
  TrackingReliability,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyScopedContext } from '../../common/tenant/company-scoped-context';
import { isUniqueConstraintViolation } from '../../common/prisma/unique-violation';
import { NotificationsService } from '../notifications/notifications.service';
import { GeofenceService } from './geofence.service';
import { DeliveryProximityService } from './delivery-proximity.service';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../common/cache/cache.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { UpdatePositionDto } from './dto/update-position.dto';
import { SmsRelayPositionDto } from './dto/sms-relay-position.dto';
import {
  haversineDistance,
  GPS_NOISE_THRESHOLD_M,
  computeFilteredDistance,
  isAccuracyTrustworthy,
} from '../../common/geo/geo.utils';
import { evaluateTeleportation } from '../../common/geo/teleportation.utils';

const STOP_SPEED_THRESHOLD_MS = 0.3; // ~1 km/h — seuil pour détecter l'arrêt (évite les égalités strictes sur flottants)
const SPEED_SMOOTHING_WINDOW = 5; // nombre de positions pour lisser la vitesse (ETA/réveil retard)
// Tolérance horloge réelle (pas fenêtre anti-spam). Un doublon = timestamp identique ou antérieur.
// Avec INTERVAL_FAST=3000 côté frontend, les 3s de battement passent sans être rejetées.
const DEDUP_CLOCK_SKEW_S = 1;

// --- Surveillance du silence GPS (Partie 1 du durcissement) ---
// Le monitor couvre TOUS les véhicules actifs (phone ET physical_tracker) assignés
// à une livraison in_progress/assigned : si aucun signal depuis plus de X minutes,
// une alerte explicite part au dashboard (notification company, push temps réel via
// NotificationsGateway pour priority high) + entrée dans le journal dédié
// (cacheService, clé tracking_silence:{vehicleId}) — le dispatcher ne découvre plus
// un problème en regardant une carte figée sans le savoir.
const SILENCE_CHECK_INTERVAL_MS = 60_000; // cadence du monitor
// Délai de grâce avant d'alerter un véhicule qui n'a JAMAIS émis (même logique que
// checkNeverConnectedDevices du pont Traccar pour les traceurs).
const NEVER_CONNECTED_GRACE_MS = 30 * 60 * 1000;
// TTL du journal de silence dans le cache (au-delà, une re-détection recrée l'entrée).
const SILENCE_JOURNAL_TTL_S = 24 * 3600;

// Source d'émission d'une position GPS. Utilisée par savePosition() pour isoler
// strictement les flux : un véhicule 'physical_tracker' ne doit recevoir que des
// positions du pont Traccar (source='physical_tracker'), jamais de l'app mobile
// chauffeur (source='phone').
export type PositionSource = 'phone' | 'physical_tracker';

@Injectable()
export class TrackingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackingService.name);

  private silenceTimer: ReturnType<typeof setInterval> | null = null;

  private metrics = {
    received: 0,
    saved: 0,
    deduped: 0,
    teleported: 0,
    batchSaved: 0,
    rateLimited: 0,
    batchRateLimited: 0,
    lastReportTime: Date.now(),
  };

  /**
   * Démarre le monitor de silence GPS (une fois par minute). Le seuil d'alerte
   * dépend de la source : 5 min pour l'app mobile (cadence 3 s), 10 min pour un
   * traceur physique (cadence variable, réseau SIM) — configurable via env.
   */
  async onModuleInit() {
    this.silenceTimer = setInterval(() => {
      this.checkSilentVehicles().catch((err) =>
        this.logger.error(`Silence monitor error: ${err.message}`),
      );
    }, SILENCE_CHECK_INTERVAL_MS);
  }

  async onModuleDestroy() {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /** Seuil de silence (min) selon la source du véhicule. */
  private getSilenceThresholdMin(source: PositionSource): number {
    const value =
      source === 'physical_tracker'
        ? Number(this.configService.get<string>('TRACKING_SILENCE_TRACKER_MIN', '10'))
        : Number(this.configService.get<string>('TRACKING_SILENCE_PHONE_MIN', '5'));
    return Number.isFinite(value) && value > 0 ? value : source === 'physical_tracker' ? 10 : 5;
  }

  /**
   * Classifie la cause probable d'un silence de traceur physique à partir de la
   * DERNIÈRE télémétrie stockée (attributes JSONB). Unités normalisées par
   * tracker-telemetry.ts (power en volts, battery en %). Retourne un label humain
   * pour le dashboard (valeur de contrôle), et null si aucune télémétrie stockée.
   */
  private classifyTrackerSilenceCause(attributes: unknown): string | null {
    if (attributes === null || attributes === undefined) {
      return 'Télémétrie non remontée par ce modèle — panne SIM/réseau ou matérielle à vérifier';
    }
    if (typeof attributes !== 'object') return null;
    const a = attributes as Record<string, unknown>;
    const power = typeof a.power === 'number' ? a.power : null;
    const battery = typeof a.battery === 'number' ? a.battery : null;

    if (power !== null && power <= 0.5) {
      return 'Coupure électrique du véhicule (tension à zéro à la dernière position)';
    }
    if (battery !== null && battery > 0 && battery <= 20) {
      return "Batterie interne du traceur critique (va cesser d'émettre)";
    }
    if (power === null && battery === null) {
      return 'Télémétrie non remontée par ce modèle — panne SIM/réseau ou matérielle à vérifier';
    }
    return 'Panne SIM/matériel ou zone sans réseau (dernière télémétrie normale)';
  }

  /**
   * Journal dédié "silences de tracking" : état par véhicule (début du silence,
   * livraison concernée, source) stocké dans le cache (Redis, ou mémoire si
   * Redis indisponible). La trace DURABLE est la notification en base (table
   * notifications, visible dans le dashboard). Le journal sert à connaître
   * l'instant de début du silence pour la vue admin temps réel.
   */
  private silenceJournalKey(vehicleId: string): string {
    return `tracking_silence:${vehicleId}`;
  }

  /**
   * Moniteur de silence GPS — TOUS les véhicules actifs (phone + physical_tracker)
   * ayant un chauffeur actif ET une livraison in_progress/assigned. Pour chaque
   * véhicule dont la dernière position date de plus du seuil (ou jamais reçue),
   * émet une alerte dashboard (une fois par période de seuil, cooldown Redis) et
   * inscrit/clôture l'entrée du journal dédié.
   */
  async checkSilentVehicles(): Promise<void> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        driver: { isActive: true, deletedAt: null },
        deliveries: {
          some: { status: { in: ['in_progress', 'assigned'] }, deletedAt: null },
        },
      },
      select: {
        id: true,
        companyId: true,
        licensePlate: true,
        positionSource: true,
        createdAt: true,
        driver: { select: { id: true, userId: true } },
        deliveries: {
          where: { status: { in: ['in_progress', 'assigned'] }, deletedAt: null },
          select: { id: true },
          take: 1,
        },
      },
    });

    // Batch-load la DERNIÈRE position de TOUS les véhicules en UNE SEULE requête
    // (au lieu d'une requête par véhicule = N+1). Les positions sont groupées par
    // vehicleId en mémoire (DISTINCT ON garde la plus récente par véhicule).
    const vehicleIds = vehicles.map((v) => v.id);
    const lastPositionRows =
      vehicleIds.length > 0
        ? await this.prisma.$queryRaw<
            Array<{
              vehicle_id: string;
              latitude: number;
              longitude: number;
              timestamp: Date;
              speed: number | null;
              source: string | null;
              attributes: unknown;
            }>
          >`
          SELECT DISTINCT ON (vehicle_id)
            vehicle_id, latitude, longitude, timestamp, speed, source, attributes
          FROM gps_positions
          WHERE vehicle_id = ANY(${vehicleIds}::uuid[])
          ORDER BY vehicle_id, timestamp DESC
        `
        : [];

    const lastPosByVehicle = new Map(
      lastPositionRows.map((r) => [
        r.vehicle_id,
        {
          latitude: r.latitude,
          longitude: r.longitude,
          timestamp: r.timestamp,
          speed: r.speed,
          source: r.source,
          attributes: r.attributes,
        },
      ]),
    );

    for (const vehicle of vehicles) {
      const source: PositionSource =
        vehicle.positionSource === 'physical_tracker' ? 'physical_tracker' : 'phone';
      const thresholdMin = this.getSilenceThresholdMin(source);
      const cooldownKey = `silence_alert:${vehicle.id}`;
      const journalKey = this.silenceJournalKey(vehicle.id);
      const deliveryId = vehicle.deliveries[0]?.id;
      const driverUserId = vehicle.driver?.userId ?? undefined;

      // Une position suspecte prouve quand même que le dispositif émet : on s'appuie
      // sur la DERNIÈRE position reçue quelle qu'elle soit (excludeSuspect=false).
      const lastPos = lastPosByVehicle.get(vehicle.id) ?? null;

      if (!lastPos) {
        // Jamais émis : on n'alerte qu'après le délai de grâce (un véhicule tout
        // juste assigné n'a pas encore démarré le tracking).
        const creationAgeMin = (Date.now() - vehicle.createdAt.getTime()) / 60000;
        if (creationAgeMin < NEVER_CONNECTED_GRACE_MS / 60000) continue;

        const notified = await this.cacheService.get<string>(cooldownKey);
        if (notified) continue;
        await this.cacheService.set(cooldownKey, '1', thresholdMin * 60);
        await this.notifications.create(vehicle.companyId, {
          type: NotificationType.device_offline,
          priority: NotificationPriority.high,
          title: 'Silence GPS — aucun signal reçu',
          message: `Le véhicule ${vehicle.licensePlate} (${source === 'physical_tracker' ? 'traceur physique' : 'app chauffeur'}) n'a encore envoyé AUCUNE position alors qu'une livraison est active. Vérifiez l'app/traceur du chauffeur.`,
          link: deliveryId ? `/tracking/${deliveryId}` : undefined,
          deliveryId,
          userId: driverUserId,
        });
        continue;
      }

      const elapsedMin = (Date.now() - lastPos.timestamp.getTime()) / 60000;

      if (elapsedMin <= thresholdMin) {
        // Le véhicule est (re)devenu audible : on clôt le silence du journal s'il
        // était ouvert (pas de notification de résolution — trop bruitée).
        await this.cacheService.invalidate(`${journalKey}*`);
        continue;
      }

      // En silence : ouvre/confirme le journal (startedAt conservé au premier passage).
      const existingJournal = await this.cacheService.get<{ startedAt: string }>(journalKey);
      if (!existingJournal) {
        await this.cacheService.set(
          journalKey,
          {
            startedAt: new Date().toISOString(),
            deliveryId: deliveryId ?? null,
            source,
            licensePlate: vehicle.licensePlate,
          },
          SILENCE_JOURNAL_TTL_S,
        );
      }

      // Alerte une fois par période de seuil (pas de spam : à 5 min de seuil, une
      // notification toutes les 5 min tant que le silence dure).
      const notified = await this.cacheService.get<string>(cooldownKey);
      if (notified) continue;
      await this.cacheService.set(cooldownKey, '1', Math.max(300, thresholdMin * 60));

      await this.notifications.create(vehicle.companyId, {
        type: NotificationType.device_offline,
        priority: NotificationPriority.high,
        title: 'Silence GPS — véhicule sans position',
        message: `Le véhicule ${vehicle.licensePlate} (${source === 'physical_tracker' ? 'traceur physique' : 'app chauffeur'}) n'a pas envoyé de position depuis ${Math.round(elapsedMin)} min. Dernière position reçue : ${lastPos.timestamp.toISOString()}.`,
        link: deliveryId ? `/tracking/${deliveryId}` : undefined,
        deliveryId,
        userId: driverUserId,
      });
    }
  }

  /**
   * Vue admin temps réel : TOUS les véhicules actifs de la compagnie avec leur
   * état de silence (durée depuis la dernière position, seuil, en silence ou non,
   * jamais connecté). Permet au dispatcher de vérifier d'un coup d'œil s'il y a
   * un souci, sans tester chaque véhicule manuellement.
   */
  async getTrackingSilences(companyId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        companyId,
        isActive: true,
        deletedAt: null,
        driver: { isActive: true, deletedAt: null },
      },
      select: {
        id: true,
        licensePlate: true,
        brand: true,
        model: true,
        positionSource: true,
        driver: { select: { id: true, firstName: true, lastName: true } },
        deliveries: {
          where: { status: { in: ['in_progress', 'assigned'] }, deletedAt: null },
          select: { id: true, title: true },
          take: 1,
        },
      },
    });

    const results = [];
    for (const vehicle of vehicles) {
      const source: PositionSource =
        vehicle.positionSource === 'physical_tracker' ? 'physical_tracker' : 'phone';
      const thresholdMin = this.getSilenceThresholdMin(source);
      const lastPos = await this.getLastPosition(vehicle.id, false);
      const elapsedMin = lastPos ? (Date.now() - lastPos.timestamp.getTime()) / 60000 : null;
      const journal = await this.cacheService.get<{ startedAt: string }>(
        this.silenceJournalKey(vehicle.id),
      );
      const delivery = vehicle.deliveries[0];

      // Cause probable d'un silence de traceur physique, dérivée de la DERNIÈRE
      // télémétrie stockée (attributes JSONB) : coupure électrique véhicule vs
      // batterie traceur critique vs panne SIM/matériel. Affiche l'info côté
      // dashboard pour orienter le diagnostic terrain sans deviner. Un modèle
      // bas de gamme sans télémétrie est signalé explicitement (limite du matériel,
      // pas un bug DelivTrack).
      let probableSilenceCause: string | null = null;
      if (source === 'physical_tracker' && lastPos) {
        probableSilenceCause = this.classifyTrackerSilenceCause(lastPos.attributes);
      }

      results.push({
        vehicleId: vehicle.id,
        licensePlate: vehicle.licensePlate,
        brand: vehicle.brand,
        model: vehicle.model,
        source,
        driverId: vehicle.driver?.id ?? null,
        driverName: vehicle.driver
          ? `${vehicle.driver.firstName} ${vehicle.driver.lastName}`
          : null,
        deliveryId: delivery?.id ?? null,
        deliveryTitle: delivery?.title ?? null,
        lastPosition: lastPos
          ? {
              latitude: lastPos.latitude,
              longitude: lastPos.longitude,
              timestamp: lastPos.timestamp,
            }
          : null,
        silenceMin: elapsedMin === null ? null : Math.round(elapsedMin * 10) / 10,
        thresholdMin,
        inSilence: elapsedMin !== null && elapsedMin > thresholdMin,
        neverConnected: elapsedMin === null,
        silenceStartedAt: journal?.startedAt ?? null,
        probableSilenceCause,
      });
    }

    // Les plus longs silences en premier (null = jamais connecté, mis en bas).
    results.sort((a, b) => (b.silenceMin ?? -1) - (a.silenceMin ?? -1));
    return results;
  }

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

  /**
   * Budget de LOTS par driver (audit 2026-08-25 G.5) : handlePosition est
   * anti-floodé mais pas batchPosition — un client authentifié pouvait contourner
   * le rate limit en rafales de 250 positions (CPU de validation + lectures DB).
   * Fenêtre fixe 60 s, budget configurable ; 0/négatif = désactivé (tests e2e).
   * Un drain légitime (rattrapage réseau) = quelques lots — très sous le défaut 30.
   */
  async isBatchRateLimited(driverId: string): Promise<boolean> {
    const max = Number(this.configService.get<string>('BATCH_RATE_LIMIT_PER_MIN', '30'));
    if (!max || max <= 0) return false;
    const key = `rate_limit_batch:${driverId}`;
    const current = await this.cacheService.get<number>(key);
    if (current !== null && current >= max) {
      this.metrics.batchRateLimited++;
      return true;
    }
    // Compteur best-effort : la course get/set entre deux batchs concurrents peut
    // sous-compter de 1 — acceptable pour une couche anti-flood (pas comptable).
    await this.cacheService.set(key, (current ?? 0) + 1, 60);
    return false;
  }

  /**
   * Logique COMMUNE de traitement d'un lot de positions — rate limit anti-flood,
   * validation parallèle (Promise.all), résolution du chauffeur, puis appel à
   * saveBatch() (INCHANGÉ). Extrait pour être partagé entre TrackingGateway
   * (WebSocket, 'batchPosition') et TrackingController (POST
   * /tracking/positions/native-batch, chemin natif indépendant du socket) : les
   * deux DOIVENT appliquer EXACTEMENT le même garde-fou anti-flood — sinon le
   * chemin REST natif deviendrait un contournement du rate limit existant.
   *
   * Chaque appelant traduit le `status` retourné dans son propre protocole
   * (émissions socket pour le gateway, réponse HTTP pour le controller) ; cette
   * méthode ne connaît ni socket.io ni HTTP.
   */
  async validateAndSaveBatch(
    userId: string,
    companyId: string,
    rawPositions: unknown,
  ): Promise<
    | { status: 'rate_limited' }
    | { status: 'empty' }
    | { status: 'no_driver' }
    // saved : any[] — même typage que saveBatch() (retourne les GpsPosition
    // Prisma réellement insérés, cf. createManyAndReturn), non re-précisé ici
    // pour ne pas dupliquer/dévier de sa signature.
    // rejected : INDEX (dans rawPositions) des positions DÉFINITIVEMENT
    // invalides, avec le motif. Voir le commentaire du bloc de validation.
    | {
        status: 'ok';
        saved: any[];
        validatedCount: number;
        driverId: string;
        rejected: Array<{ index: number; reason: string }>;
      }
  > {
    if (await this.isBatchRateLimited(userId)) {
      this.logger.warn(`Batch rate limited (driver=${userId})`);
      return { status: 'rate_limited' };
    }

    if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
      return { status: 'empty' };
    }

    // Validation PARALLÈLE (Promise.all) : un rattrapage réseau peut compter
    // plusieurs milliers de positions, une boucle séquentielle for...await
    // validate() rendait ce traitement > 3s — voir handleBatchPosition (gateway),
    // logique identique déplacée ici sans changement de comportement.
    const validationResults = await Promise.all(
      rawPositions.map(async (raw) => {
        const instance = plainToInstance(UpdatePositionDto, raw, {
          exposeUnsetFields: false,
          enableImplicitConversion: true,
        });
        const errors = await validate(instance, {
          whitelist: true,
          skipMissingProperties: false,
        });
        return { instance, errors };
      }),
    );

    // BUG CORRIGÉ (audit GPS 2026-08-28, A1 — CRITIQUE, perte de données) :
    // une position invalide était jetée par un simple `continue`, le lot
    // répondait quand même 200, et le worker natif (PositionUploadWorker) —
    // qui ne lit pas le corps de la réponse — marquait TOUT le lot `synced`,
    // détruisant définitivement les positions rejetées. Pire cas reproductible :
    // une horloge d'appareil décalée de plus de 5 min invalidait TOUTES les
    // positions (IsPlausibleTimestamp) → validatedCount=0 → 200 → la file
    // native entière était effacée lot par lot, sans une seule erreur visible.
    //
    // On remonte désormais l'INDEX et le MOTIF de chaque rejet à l'appelant.
    // Ces positions sont définitivement invalides (les retenter à l'identique
    // échouerait indéfiniment et bloquerait la file — head-of-line blocking),
    // mais leur destruction devient EXPLICITE et comptabilisée, jamais
    // silencieuse.
    const validatedPositions: UpdatePositionDto[] = [];
    const rejected: Array<{ index: number; reason: string }> = [];
    validationResults.forEach(({ instance, errors }, index) => {
      if (errors.length > 0) {
        const reason = errors
          .map((e) => Object.keys(e.constraints || {}))
          .flat()
          .join(', ');
        this.logger.warn(`Batch position invalid (driver=${userId}, index=${index}): ${reason}`);
        rejected.push({ index, reason: reason || 'invalid' });
        return;
      }
      validatedPositions.push(instance);
    });

    if (rejected.length > 0) {
      this.logger.warn(
        `[gps-loss] ${rejected.length}/${rawPositions.length} position(s) DÉFINITIVEMENT rejetée(s) ` +
          `(driver=${userId}) — motifs: ${[...new Set(rejected.map((r) => r.reason))].join(' | ')}`,
      );
    }

    const driver = await this.findDriverByUserId(userId);
    if (!driver) {
      return { status: 'no_driver' };
    }

    if (validatedPositions.length === 0) {
      return { status: 'ok', saved: [], validatedCount: 0, driverId: driver.id, rejected };
    }

    const saved = await this.saveBatch(userId, driver.id, validatedPositions, companyId);
    return {
      status: 'ok',
      saved,
      validatedCount: validatedPositions.length,
      driverId: driver.id,
      rejected,
    };
  }

  logMetrics() {
    const now = Date.now();
    const elapsedMin = (now - this.metrics.lastReportTime) / 60000;
    this.logger.log(
      `[METRICS] received=${this.metrics.received} saved=${this.metrics.saved} deduped=${this.metrics.deduped} teleported=${this.metrics.teleported} batch=${this.metrics.batchSaved} rateLimited=${this.metrics.rateLimited} batchRateLimited=${this.metrics.batchRateLimited} (last ${elapsedMin.toFixed(1)}min)`,
    );
    this.metrics = {
      received: 0,
      saved: 0,
      deduped: 0,
      teleported: 0,
      batchSaved: 0,
      rateLimited: 0,
      batchRateLimited: 0,
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
        // accuracy : nécessaire à la dérivation prudente de la vitesse côté
        // gateway (audit GPS 2026-08-28, C8) — on ne dérive une vitesse
        // haversine/Δt que si les deux extrémités sont assez précises.
        accuracy: true,
        source: true,
        attributes: true,
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
    _savedPosition: { id: string; suspect: boolean },
    prevPosition?: { timestamp: Date; speed: number | null } | null,
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
      prevPosition &&
      settings.prolongedStopMinutes &&
      dto.speed !== undefined &&
      dto.speed < STOP_SPEED_THRESHOLD_MS
    ) {
      // La position PRÉCÉDENTE est transmise (capturée AVANT l'insertion) : sans cela,
      // getLastPosition() retournait la position qu'on vient d'écrire → stoppedMs = 0 →
      // l'alerte « arrêt prolongé » ne se déclenchait JAMAIS.
      const lastPos = prevPosition;
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

    if (dto.deliveryId && dto.speed !== undefined && dto.speed > 0) {
      // P0 : sans deliveryId (chauffeur roulant sans livraison active — cas courant),
      // findUnique({ id: undefined }) levait une PrismaClientValidationError qui faisait
      // tomber TOUT generateAlerts → aucune alerte (vitesse, stop) n'était émise.
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
            // P1 : sans cooldown, chaque position (~3s) créait une ligne delay_alert →
            // inondation des notifications pendant tout le retard. Même mécanisme que
            // le speed alert (cache 300s).
            const delayKey = `delay_alert:${dto.vehicleId}`;
            const delaySent = await this.cacheService.get<boolean>(delayKey);
            if (!delaySent) {
              await this.cacheService.set(delayKey, true, 900);
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
    }

    // Un point suspect prouve quand même que le dispositif transmet : il ne doit PAS
    // compter comme une perte de signal (sinon un véhicule dont les dernières positions
    // sont suspectes serait déclaré "offline" à tort). La position PRÉCÉDENTE est
    // transmise (capturée avant l'insertion) : sinon getLastPosition() retournait la
    // position courante → gap = 0 → l'alerte « signal perdu » ne se déclenchait JAMAIS.
    const lastPos = prevPosition ?? (await this.getLastPosition(dto.vehicleId, false));
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

    if (dto.deliveryId) {
      tasks.push(
        this.emitGeofenceEvents(
          dto.deliveryId,
          dto.vehicleId,
          dto.latitude,
          dto.longitude,
          companyId,
          driverId,
          alertUserId,
        ),
      );
    }

    await Promise.allSettled(tasks);
  }

  /**
   * Évalue les géofences d'une livraison pour une position et, à chaque entrée /
   * sortie, crée la notification + émet l'évènement temps réel. Chemin PARTAGÉ
   * entre generateAlerts (temps réel / batch téléphone) et replayBackfillSideEffects
   * (rattrapage Traccar) — une seule implémentation, même comportement quelle que
   * soit la source.
   */
  private async emitGeofenceEvents(
    deliveryId: string,
    vehicleId: string,
    latitude: number,
    longitude: number,
    companyId: string,
    driverId: string | null,
    alertUserId: string | null,
  ): Promise<void> {
    const geofenceEvents = await this.geofenceService.checkGeofences(
      deliveryId,
      vehicleId,
      latitude,
      longitude,
    );
    for (const geofenceEvent of geofenceEvents) {
      await this.notifications.create(companyId, {
        type: NotificationType.geofence_event,
        priority: NotificationPriority.high,
        title: `Geofence ${geofenceEvent.event === 'entry' ? 'Entry' : 'Exit'}`,
        message: `Vehicle ${geofenceEvent.event === 'entry' ? 'entered' : 'exited'} "${geofenceEvent.geofenceName}"`,
        link: `/tracking/${deliveryId}`,
        deliveryId,
        userId: alertUserId ?? undefined,
      });
      this.dataUpdateBus.emit('dataUpdate', {
        companyId,
        entity: 'geofence_event',
        action: geofenceEvent.event,
        payload: {
          event: geofenceEvent.event,
          geofenceId: geofenceEvent.geofenceId,
          geofenceName: geofenceEvent.geofenceName,
          deliveryId,
          vehicleId,
          driverId,
        },
      });
    }
  }

  /**
   * Effets de bord STATEFULS (proximité livraison + géofences) à rejouer sur le
   * DERNIER point fiable d'un lot de rattrapage Traccar (performBackfill).
   *
   * PARITÉ : le flush de file offline du téléphone (saveBatch) réévalue déjà
   * proximité + géofences après une coupure réseau ; le backfill Traccar ne le
   * faisait pas, donc un traceur physique qui franchissait une géofence ou
   * arrivait à destination pendant une coupure Traccar ne produisait ni évènement
   * géofence ni invite « validez la livraison ». Ces deux effets sont idempotents
   * (clés Redis côté proximité, table geofence_events côté géofence). Les alertes
   * temps réel (vitesse / arrêt / retard / offline) restent volontairement
   * exclues : périmées sur de la donnée d'archive.
   */
  async replayBackfillSideEffects(params: {
    driverId: string | null;
    vehicleId: string;
    companyId: string;
    deliveryId: string | null;
    latitude: number;
    longitude: number;
    timestamp: Date;
  }): Promise<void> {
    const { driverId, vehicleId, companyId, deliveryId, latitude, longitude, timestamp } = params;
    const tasks: Promise<unknown>[] = [];

    if (deliveryId) {
      let alertUserId: string | null = null;
      if (driverId) {
        const driverRow = await this.prisma.driver.findFirst({
          where: { id: driverId },
          select: { userId: true },
        });
        alertUserId = driverRow?.userId ?? null;
      }
      tasks.push(
        this.emitGeofenceEvents(
          deliveryId,
          vehicleId,
          latitude,
          longitude,
          companyId,
          driverId,
          alertUserId,
        ),
      );
    }

    if (driverId) {
      tasks.push(
        this.deliveryProximityService.checkProximity(
          driverId,
          vehicleId,
          companyId,
          latitude,
          longitude,
          timestamp,
        ),
      );
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
    attributes?: Record<string, unknown> | null,
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

    // Position PRÉCÉDENTE capturée AVANT l'insertion : generateAlerts en a besoin
    // pour les alertes « arrêt prolongé » et « signal perdu » (comparaison avec le
    // point précédent, PAS avec celui qu'on vient d'écrire).
    const prevPosition = await this.getLastPosition(dto.vehicleId, false);

    let saved;
    try {
      saved = await this.prisma.gpsPosition.create({
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
          attributes:
            attributes && Object.keys(attributes).length > 0
              ? (attributes as Prisma.InputJsonValue)
              : undefined,
        },
      });
    } catch (err: unknown) {
      // Contrainte unique (vehicleId, timestamp) : filet anti-doublon de DERNIER
      // recours. Le dédoublonnage temporel (fenêtre 1s) ci-dessus intercepte déjà
      // les retransmissions, mais une P2002 peut encore survenir en course
      // backfill/live multi-réplica : on la traite comme une position déjà présente
      // (log debug, jamais d'erreur remontée à l'appelant — le client considérerait
      // sinon sa position comme perdue et la remettrait en file).
      if (isUniqueConstraintViolation(err)) {
        this.metrics.deduped++;
        this.logger.debug(
          `Duplicate position rejected (unique constraint): vehicle=${dto.vehicleId} ts=${dto.timestamp}`,
        );
        return null;
      }
      throw err;
    }

    this.metrics.saved++;

    if (this.metrics.received % 100 === 0) {
      this.logMetrics();
    }

    if (companyId && !suspect) {
      this.generateAlerts(dto, companyId, driverId, saved, prevPosition).catch((err) =>
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
    // Copie IMMUABLE de la dernière position DB par véhicule : utilisée pour détecter
    // une vraie retransmission du point le plus récent (le Map lastPositions, lui, est
    // mis à jour au fil du lot pour servir de référence téléportation/vitesse).
    const dbLastPositions = new Map(lastPositions);
    // Accuracy de la dernière position retenue par véhicule — nécessaire à la
    // dérivation prudente de la vitesse (voir C8 plus bas). Non porté par
    // lastPositions, dont la forme est partagée avec la lecture DB ci-dessus.
    const lastAccuracy = new Map<string, number | null | undefined>();

    // 1er passage : ne garder que les positions VALIDES (IDs bien formés, livraison du bon
    // chauffeur, véhicule actif). Le tri chronologique s'applique à ce sous-ensemble, pas
    // aux données qui seront de toute façon rejetées (inutile de trier du bruit).
    const validPositions: typeof positions = [];
    for (const pos of positions) {
      // BUG CORRIGÉ (audit GPS 2026-08-28, A8) : une livraison terminée ou
      // réassignée pendant que le téléphone était hors ligne rendait le
      // deliveryId de la file obsolète, et TOUTE la trace était détruite —
      // alors que la trajectoire du VÉHICULE reste une donnée parfaitement
      // valide, et qu'elle alimente le rapport carburant (calculé par
      // véhicule, pas par livraison). On DÉTACHE désormais la livraison
      // (deliveryId = null) au lieu de jeter la position.
      let effectiveDeliveryId: string | null | undefined = pos.deliveryId;
      if (effectiveDeliveryId && !verifiedDeliveries.has(effectiveDeliveryId)) {
        this.logger.warn(
          `Batch position détachée de sa livraison (non assignée/supprimée): ` +
            `delivery=${effectiveDeliveryId} driver=${driverId} — position CONSERVÉE sans livraison`,
        );
        effectiveDeliveryId = null;
      }
      if (
        effectiveDeliveryId !== undefined &&
        effectiveDeliveryId !== null &&
        effectiveDeliveryId.length < 16
      ) {
        effectiveDeliveryId = null;
      }

      if (!pos.vehicleId || pos.vehicleId.length < 16) continue;

      if (!validVehicleIds.has(pos.vehicleId)) {
        this.logger.warn(
          `Batch position rejected: vehicle ${pos.vehicleId} not found, inactive or soft-deleted (driver=${driverId})`,
        );
        continue;
      }

      // La position conserve toutes ses autres données ; seule l'association
      // livraison a pu être neutralisée ci-dessus.
      validPositions.push({ ...pos, deliveryId: effectiveDeliveryId ?? undefined });
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
      const dbLatest = dbLastPositions.get(pos.vehicleId);

      // Fenêtre SYMÉTRIQUE sur les DEUX références (DB + lot) :
      //  - un backfill (position plus ANCIENNE que la dernière DB, diff négative — file
      //    IndexedDB flushée après coupure) est une donnée nouvelle légitime : JAMAIS rejeté ;
      //  - seule une vraie retransmission (même instant ±1s) est dédoublonnée — soit contre
      //    la position précédente du lot, soit contre la dernière position DB (retransmission
      //    du point le plus récent, garde conservée par dbLastPositions immuable).
      const isDup =
        (last &&
          Math.abs((ts.getTime() - last.timestamp.getTime()) / 1000) <= DEDUP_CLOCK_SKEW_S) ||
        (dbLatest &&
          Math.abs((ts.getTime() - dbLatest.timestamp.getTime()) / 1000) <= DEDUP_CLOCK_SKEW_S);

      if (isDup) {
        this.metrics.deduped++;
        this.logger.debug(
          `Batch duplicate rejected (timestamp): vehicle=${pos.vehicleId} ts=${pos.timestamp}`,
        );
        continue;
      }

      // Différence vs la référence du lot (dernier candidat traité pour ce véhicule) :
      // utilisée pour la vitesse de secours et la téléportation (négatif = backfill,
      // dans ce cas on saute ces deux calculs — pas de référence antérieure fiable).
      const timeDiffSec = last ? (ts.getTime() - last.timestamp.getTime()) / 1000 : Infinity;

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
        Number.isFinite(timeDiffSec) &&
        // BUG CORRIGÉ (audit GPS 2026-08-28, C8) : cette vitesse DÉRIVÉE
        // (haversine/Δt) est stockée en base indistinctement d'une vitesse
        // mesurée par le mobile, puis relue par la RÈGLE VITESSE de
        // computeFilteredDistance — qui compte alors le segment EN ENTIER.
        // Raisonnement circulaire : un saut de bruit GPS de 20 m en 3 s produit
        // une « vitesse » de 6,7 m/s (> MOVEMENT_SPEED_THRESHOLD_MS) qui valide
        // son propre segment de bruit. On ne dérive donc une vitesse que si les
        // DEUX extrémités sont assez précises pour que le déplacement mesuré
        // soit réel (même plafond que MOVEMENT_TRUST_MAX_ACCURACY_M).
        isAccuracyTrustworthy(pos.accuracy) &&
        isAccuracyTrustworthy(lastAccuracy.get(pos.vehicleId))
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
      lastAccuracy.set(pos.vehicleId, pos.accuracy);

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
    // skipDuplicates: true + P2002 capturée : filet de dernier recours de la
    // contrainte unique (vehicleId, timestamp) — un doublon exact dans le lot (ou
    // une course inter-réplicas) est ignoré proprement (ON CONFLICT DO NOTHING), les
    // autres lignes du lot restent insérées, et createManyAndReturn ne renvoie que
    // les lignes RÉELLEMENT insérées. Jamais d'erreur remontée à l'appelant pour
    // une position déjà présente.
    let inserted: Array<{
      id: string;
      latitude: number;
      longitude: number;
      speed: number | null;
      heading: number | null;
      altitude: number | null;
      accuracy: number | null;
      suspect: boolean;
      timestamp: Date;
      deliveryId: string | null;
      vehicleId: string;
    }> = [];
    try {
      inserted = await this.prisma.gpsPosition.createManyAndReturn({
        data: toInsert,
        skipDuplicates: true,
      });
    } catch (err: unknown) {
      if (isUniqueConstraintViolation(err)) {
        this.logger.debug(
          `Batch positions already present (unique constraint): ${err instanceof Error ? err.message : 'P2002'} — treated as duplicates`,
        );
        return saved;
      }
      throw err;
    }

    this.metrics.saved += inserted.length;

    // Dernier enregistrement inséré par véhicule : sert de position « précédente »
    // pour generateAlerts (arrêt prolongé / signal perdu), comme le chemin temps réel.
    const lastByVehicle = new Map<string, { timestamp: Date; speed: number | null }>();
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
          lastByVehicle.get(record.vehicleId) ?? null,
        ).catch((err) => this.logger.error(`Alert generation failed: ${err}`));
      }
      lastByVehicle.set(record.vehicleId, {
        timestamp: record.timestamp,
        speed: record.speed ?? null,
      });
    }

    // Proximité : évaluée sur le DERNIER point de CHAQUE véhicule présent dans le lot
    // (pas seulement le dernier point global). Après un rattrapage réseau (flush
    // IndexedDB), le point le plus récent du lot peut être loin de la destination alors
    // que le chauffeur y est passé en milieu de lot — sans cette boucle, l'alerte
    // « validez la livraison » (proximity) était perdue pour ce passage. checkProximity
    // est idempotent côté serveur (clés Redis entered/snoozed) : aucun double-alert
    // possible sur la même zone.
    if (companyId && lastByVehicle.size > 0) {
      for (const vehicleId of lastByVehicle.keys()) {
        const last = inserted.find((r) => r.vehicleId === vehicleId);
        if (!last) continue;
        this.deliveryProximityService
          .checkProximity(
            driverId,
            vehicleId,
            companyId,
            last.latitude,
            last.longitude,
            last.timestamp,
          )
          .catch((err) => this.logger.error(`Proximity check failed: ${err}`));
      }
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
    // AUCUNE troncature silencieuse : le rapport de trajet (getTripReport / PDF) et le
    // calcul de distance/durée doivent reposer sur TOUTES les positions GPS réelles de
    // la livraison, sans échantillonnage ni LIMIT arbitraire qui fausserait distance ou
    // durée. Une livraison de 24 h à la cadence minimale de 3 s ≈ 28 800 lignes — chargé
    // en mémoire sans risque (une ligne ~100 octets). Tri par timestamp (fixTime GPS réel,
    // pas l'heure d'arrivée serveur) : un backfill/retry arrivé en retard garde sa place
    // chronologique exacte.
    return this.prisma.gpsPosition.findMany({
      where,
      orderBy: { timestamp: 'asc' },
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

    // Contrôle GLOBAL (tous tenants, tous états) : traccarDeviceId est @unique en
    // base. CompanyScopedContext.run(null) désactive l'injection du companyId par
    // le middleware tenant — sinon on ne détecterait qu'une collision INTRA-
    // entreprise et une collision cross-tenant tomberait en P2002 → 500.
    // LIMITE CONNUE : un traceur jamais lié reste revendicable par tout tenant
    // qui en connaît l'ID (cf. AUDIT_APPROFONDI_2026-08-28) — mitigation complète
    // = preuve de possession, non faite ici.
    const otherVehicle = await CompanyScopedContext.run(null, () =>
      this.prisma.vehicle.findFirst({
        where: {
          traccarDeviceId,
          id: { not: vehicleId },
        },
        select: { id: true },
      }),
    );
    if (otherVehicle) {
      throw new ConflictException(
        `traccarDeviceId "${traccarDeviceId}" is already assigned to another vehicle`,
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

  /**
   * Taux de couverture GPS réel d'un trajet : % du temps (entre la première et la
   * dernière position) pendant lequel des positions valides ont été reçues. Les
   * trous au-delà du seuil de gap (défaut 3 min, TRACKING_GAP_THRESHOLD_MIN) sont
   * du temps NON couvert. Permet de mesurer objectivement la fiabilité obtenue
   * (chauffeur/téléphone/traceur) au lieu de promettre une fiabilité théorique.
   */
  computeCoverage(
    positions: Array<{ timestamp: Date }>,
    gapThresholdSec: number,
  ): { coveragePct: number; totalSec: number; coveredSec: number; gapCount: number } {
    if (positions.length < 2) {
      return { coveragePct: 100, totalSec: 0, coveredSec: 0, gapCount: 0 };
    }
    const sorted = [...positions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const first = sorted[0].timestamp.getTime();
    const last = sorted[sorted.length - 1].timestamp.getTime();
    const totalSec = Math.max(0, (last - first) / 1000);
    if (totalSec <= 0) return { coveragePct: 100, totalSec: 0, coveredSec: 0, gapCount: 0 };
    let uncoveredSec = 0;
    let gapCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      const gapSec = (sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()) / 1000;
      if (gapSec > gapThresholdSec) {
        uncoveredSec += gapSec;
        gapCount++;
      }
    }
    const coveredSec = Math.max(0, totalSec - uncoveredSec);
    const coveragePct = totalSec > 0 ? Math.round((coveredSec / totalSec) * 1000) / 10 : 100;
    return { coveragePct, totalSec, coveredSec, gapCount };
  }

  async getTripReport(deliveryId: string, companyId: string) {
    const positions = await this.getAllPositionsByDelivery(deliveryId, companyId);
    const delivery = await this.getDeliveryInfo(deliveryId, companyId);

    const emptyReport = {
      delivery,
      totalDistance: { meters: 0, kilometers: 0 },
      avgSpeedKmh: 0,
      totalDurationSec: 0,
      stopCount: 0,
      positionCount: 0,
      postgisDistance: { meters: 0, kilometers: 0 } as {
        meters: number;
        kilometers: number;
      } | null,
      signalGaps: [] as Array<{
        fromTimestamp: string;
        toTimestamp: string;
        durationSec: number;
        fromLatitude: number;
        fromLongitude: number;
        toLatitude: number;
        toLongitude: number;
      }>,
      signalInterrupted: false,
      uniqueDriverCount: 0,
      // Couverture GPS du trajet (% du temps avec position valide reçue). 100 = aucun
      // trou au-delà du seuil. Mesure réelle de la fiabilité du tracking pour ce trajet.
      trackingCoveragePct: 100,
    };
    if (positions.length === 0) {
      return emptyReport;
    }

    const totalDistance = await this.calculateDistance(deliveryId, companyId);

    // AUDIT 2026-08-28 : `calculateDistancePostGIS` applique un seuil de bruit
    // FIXE à 5 m (aucune pondération par l'accuracy, aucun cap vitesse × Δt) —
    // il sur-compte massivement le bruit GPS, exactement le bug que
    // computeFilteredDistance vient de corriger. Le montrer comme une
    // « estimation alternative » à côté du vrai chiffre créait un écart alarmant
    // (ex. 49 km vs 80 km) sur une donnée que l'utilisateur ne peut pas
    // arbitrer. On expose désormais UNE seule distance, celle qui fait foi pour
    // le carburant. `postgisDistance` reste renseigné (= la même valeur) pour ne
    // pas casser le contrat de l'API ni le frontend existant.
    const postgisDistance = totalDistance;

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

    // Détection de trous dans le trajet (gap detection) : tout écart de temps anormal
    // entre deux positions CONSÉCUTIVES (au-delà du seuil, défaut 3 min) est signalé
    // explicitement dans le rapport au lieu de tracer une ligne droite silencieuse
    // qui donnerait une fausse impression de trajet continu. Seuil configurable via
    // TRACKING_GAP_THRESHOLD_MIN (min). Un écart plus court que la cadence normale est
    // ignoré (arrêt à quai, cadence ralentie à l'arrêt = 20 s).
    const gapThresholdMin = Number(
      this.configService.get<string>('TRACKING_GAP_THRESHOLD_MIN', '3'),
    );
    const gapThresholdSec =
      (Number.isFinite(gapThresholdMin) && gapThresholdMin > 0 ? gapThresholdMin : 3) * 60;
    const signalGaps: typeof emptyReport.signalGaps = [];
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const gapSec = (curr.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
      if (gapSec > gapThresholdSec) {
        signalGaps.push({
          fromTimestamp: prev.timestamp.toISOString(),
          toTimestamp: curr.timestamp.toISOString(),
          durationSec: Math.round(gapSec),
          fromLatitude: prev.latitude,
          fromLongitude: prev.longitude,
          toLatitude: curr.latitude,
          toLongitude: curr.longitude,
        });
      }
    }

    // Nombre de chauffeurs distincts ayant émis sur ce trajet (change de chauffeur
    // en cours de route = segments attribués au bon conducteur, cf. VehicleAssignmentHistory).
    const uniqueDrivers = new Set(
      positions.map((p) => p.driverId).filter((id): id is string => !!id),
    );

    // Couverture GPS = temps couvert / temps total (les gaps > seuil sont du temps
    // non couvert). Mesure la fiabilité RÉELLE du tracking sur ce trajet.
    const coverage = this.computeCoverage(positions, gapThresholdSec);

    return {
      delivery,
      totalDistance,
      avgSpeedKmh,
      totalDurationSec,
      stopCount,
      positionCount: positions.length,
      postgisDistance,
      signalGaps,
      signalInterrupted: signalGaps.length > 0,
      uniqueDriverCount: uniqueDrivers.size,
      trackingCoveragePct: coverage.coveragePct,
    };
  }

  /**
   * Rapport de fiabilité du tracking par véhicule/chauffeur sur la période : % du
   * temps de livraison avec position GPS valide reçue (couverture moyenne pondérée
   * par la durée de chaque livraison), + nombre de trous signalés. Permet au
   * dispatcher de savoir objectivement si un chauffeur/téléphone particulier pose
   * problème récurrent (mauvais téléphone, habitude de fermer l'app) plutôt que
   * d'accuser le système à tort.
   */
  async getTrackingReliability(companyId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const gapThresholdMin = Number(
      this.configService.get<string>('TRACKING_GAP_THRESHOLD_MIN', '3'),
    );
    const gapThresholdSec =
      (Number.isFinite(gapThresholdMin) && gapThresholdMin > 0 ? gapThresholdMin : 3) * 60;

    const deliveries = await this.prisma.delivery.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ['delivered', 'failed'] },
        createdAt: { gte: since },
      },
      select: {
        id: true,
        vehicleId: true,
        driverId: true,
        completedAt: true,
      },
    });

    // Par véhicule (les positions sont rattachées au véhicule, pas au chauffeur).
    const byVehicle = new Map<
      string,
      {
        vehicleId: string;
        deliveries: number;
        totalSec: number;
        coveredSec: number;
        gaps: number;
        positions: number;
        source: PositionSource;
        lastDeliveryCompletedAt: Date | null;
      }
    >();

    // Batch-load TOUTES les positions pour TOUTES les livraisons en UNE SEULE
    // requête (au lieu d'une requête par livraison = N+1). Les positions sont
    // groupées par (vehicleId, deliveryId) en mémoire pour calculer la couverture
    // par livraison individuellement.
    const deliveryVehiclePairs = deliveries
      .filter((d) => d.vehicleId)
      .map((d) => ({ vehicleId: d.vehicleId!, deliveryId: d.id, completedAt: d.completedAt }));

    if (deliveryVehiclePairs.length > 0) {
      const deliveryIds = [...new Set(deliveryVehiclePairs.map((d) => d.deliveryId))];
      const vehicleIds = [...new Set(deliveryVehiclePairs.map((d) => d.vehicleId))];

      const allPositions = await this.prisma.gpsPosition.findMany({
        where: {
          vehicleId: { in: vehicleIds },
          deliveryId: { in: deliveryIds },
          suspect: false,
        },
        select: { vehicleId: true, deliveryId: true, timestamp: true },
        orderBy: { timestamp: 'asc' },
      });

      // Grouper par (vehicleId, deliveryId) en mémoire
      const positionsByDelivery = new Map<string, Array<{ timestamp: Date }>>();
      for (const pos of allPositions) {
        if (!pos.deliveryId) continue;
        const key = `${pos.vehicleId}:${pos.deliveryId}`;
        const arr = positionsByDelivery.get(key) ?? [];
        arr.push({ timestamp: pos.timestamp });
        positionsByDelivery.set(key, arr);
      }

      for (const pair of deliveryVehiclePairs) {
        const key = `${pair.vehicleId}:${pair.deliveryId}`;
        const positions = positionsByDelivery.get(key) ?? [];
        const coverage = this.computeCoverage(positions, gapThresholdSec);
        const agg = byVehicle.get(pair.vehicleId) ?? {
          vehicleId: pair.vehicleId,
          deliveries: 0,
          totalSec: 0,
          coveredSec: 0,
          gaps: 0,
          positions: 0,
          source: 'phone' as PositionSource,
          lastDeliveryCompletedAt: null,
        };
        agg.deliveries += 1;
        agg.totalSec += coverage.totalSec;
        agg.coveredSec += coverage.coveredSec;
        agg.gaps += coverage.gapCount;
        agg.positions += positions.length;
        if (
          pair.completedAt &&
          (!agg.lastDeliveryCompletedAt || pair.completedAt > agg.lastDeliveryCompletedAt)
        ) {
          agg.lastDeliveryCompletedAt = pair.completedAt;
        }
        byVehicle.set(pair.vehicleId, agg);
      }
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        id: { in: [...byVehicle.keys()] },
        companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        licensePlate: true,
        brand: true,
        model: true,
        positionSource: true,
        driver: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

    const rows = [...byVehicle.entries()].map(([vehicleId, agg]) => {
      const vehicle = vehicleMap.get(vehicleId);
      const coveragePct =
        agg.totalSec > 0 ? Math.round((agg.coveredSec / agg.totalSec) * 1000) / 10 : 100;
      return {
        vehicleId,
        licensePlate: vehicle?.licensePlate ?? null,
        brand: vehicle?.brand ?? null,
        model: vehicle?.model ?? null,
        source: (vehicle?.positionSource as PositionSource) ?? agg.source,
        driverId: vehicle?.driver?.id ?? null,
        driverName: vehicle?.driver
          ? `${vehicle.driver.firstName} ${vehicle.driver.lastName}`
          : null,
        deliveries: agg.deliveries,
        positions: agg.positions,
        // Couverture moyenne pondérée par la durée de chaque livraison : un long trajet
        // fiable pèse plus qu'un court trajet avec un trou.
        coveragePct,
        coverageLabel:
          coveragePct >= 98
            ? 'excellent'
            : coveragePct >= 90
              ? 'bon'
              : coveragePct >= 75
                ? 'moyen'
                : 'faible',
        gaps: agg.gaps,
        lastDeliveryCompletedAt: agg.lastDeliveryCompletedAt,
      };
    });

    rows.sort((a, b) => a.coveragePct - b.coveragePct);
    return { days, periodSince: since, vehicles: rows };
  }

  /**
   * Signalement (par le JS de l'app mobile, au lancement) d'une interruption NON
   * volontaire du tracking détectée nativement (service tué / force-stop partiel).
   * Crée une notification dashboard immédiate pour que l'interruption soit visible
   * côté entreprise plutôt que découverte a posteriori.
   */
  async reportTrackingInterruption(
    userId: string,
    body: { interruptedAt?: string; reason?: string; deliveryId?: string; vehicleId?: string },
  ) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, firstName: true, lastName: true, companyId: true },
    });
    if (!driver) return { reported: false, reason: 'driver_not_found' };

    const interruptedAt = body.interruptedAt ? new Date(body.interruptedAt) : new Date();
    const timeLabel = interruptedAt.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const reasonLabel =
      body.reason === 'watchdog_detected_dead'
        ? 'app tuée par le système'
        : body.reason === 'service_killed'
          ? 'app fermée manuellement ou tuée par le système'
          : 'raison inconnue';

    const driverName = `${driver.firstName} ${driver.lastName}`;
    const message = `Le suivi du chauffeur ${driverName} a été interrompu à ${timeLabel} (${reasonLabel}). L'app a dû être rouverte.`;

    const notification = await this.notifications.create(driver.companyId, {
      type: NotificationType.system,
      priority: NotificationPriority.high,
      title: 'Tracking interrompu',
      message,
      link: body.deliveryId ? `/tracking/${body.deliveryId}` : undefined,
      deliveryId: body.deliveryId,
    });
    return { reported: true, notificationId: notification.id };
  }

  /**
   * Batterie critique (niveau ≤ 20 %, signalé par le foreground service natif avant
   * extinction probable) : le dispatcher voit la cause probable de l'interruption
   * au lieu d'un silence inexpliqué.
   */
  async reportBatteryCritical(
    userId: string,
    body: {
      level?: number;
      vehicleId?: string;
      deliveryId?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, firstName: true, lastName: true, companyId: true, vehicleId: true },
    });
    if (!driver) return { reported: false, reason: 'driver_not_found' };

    const level = typeof body.level === 'number' ? Math.round(body.level) : null;
    const vehicleId = body.vehicleId || driver.vehicleId;
    const vehicle = vehicleId
      ? await this.prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: { licensePlate: true },
        })
      : null;

    const levelLabel = level !== null ? `Batterie critique (${level}%)` : 'Batterie critique';
    const message =
      `Le téléphone du chauffeur ${driver.firstName} ${driver.lastName}` +
      (vehicle ? ` (véhicule ${vehicle.licensePlate})` : '') +
      ` signale un niveau de batterie critique. Le suivi peut s'interrompre si le téléphone s'éteint.`;

    const notification = await this.notifications.create(driver.companyId, {
      type: NotificationType.device_offline,
      priority: NotificationPriority.high,
      title: levelLabel,
      message,
      link: body.deliveryId ? `/tracking/${body.deliveryId}` : undefined,
      deliveryId: body.deliveryId,
    });

    // Sauvegarde la dernière position connue comme position finale (avec la batterie
    // en contexte) : le dispatcher voit où était le véhicule au moment du signal.
    // Isolation des sources conservée : uniquement pour les véhicules 'phone' (un
    // véhicule physical_tracker ne doit pas recevoir une position de l'app mobile).
    if (vehicleId && typeof body.latitude === 'number' && typeof body.longitude === 'number') {
      try {
        const targetVehicle = await this.prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: { positionSource: true },
        });
        if (targetVehicle && targetVehicle.positionSource !== 'physical_tracker') {
          await this.prisma.gpsPosition.create({
            data: {
              latitude: body.latitude,
              longitude: body.longitude,
              speed: null,
              heading: null,
              altitude: null,
              accuracy: null,
              suspect: false,
              location: `POINT(${body.longitude} ${body.latitude})`,
              timestamp: new Date(),
              companyId: driver.companyId,
              deliveryId: body.deliveryId ?? null,
              vehicleId,
              driverId: driver.id,
              source: 'phone',
            },
          });
        }
      } catch {
        // Non bloquant : la notification reste l'essentiel.
      }
    }
    return { reported: true, notificationId: notification.id };
  }

  /**
   * Met à jour la fiabilité du tracking GPS-téléphone DU chauffeur authentifié
   * (résolu depuis userId — jamais un driverId fourni par le client, pour
   * qu'un chauffeur ne puisse modifier que son propre statut). Appelé par
   * useDriverTracking.ts (frontend) à chaque changement détecté de
   * batteryOptimizationIgnored/deviceOem.
   */
  async updateTrackingReliability(userId: string, status: TrackingReliability) {
    const driver = await this.prisma.driver.findUnique({
      where: { userId },
      select: { id: true, companyId: true },
    });
    if (!driver) return { updated: false, reason: 'driver_not_found' as const };

    await this.prisma.driver.update({
      where: { id: driver.id },
      data: { trackingReliability: status },
    });

    return { updated: true, trackingReliability: status };
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
    // MÊME garde que la version par entreprise (audit 2026-08-25 G.2) : sans elle,
    // un `before` récent archivait/supprimait des positions < 48 h de TOUTES les
    // sociétés avant que le cron carburant (22 h) et les rapports à la demande ne
    // les consomment. La validation de format ISO est faite côté contrôleur ; ici
    // on protège le métier quel que soit l'appelant.
    const minAge = new Date(Date.now() - 48 * 60 * 60 * 1000);
    if (date > minAge) {
      this.logger.warn(
        `archiveAllCompaniesPositionsBefore refused: date ${date.toISOString()} is less than 48h old`,
      );
      return 0;
    }
    this.logger.warn(
      'archiveAllCompaniesPositionsBefore called — this archives positions for ALL companies',
    );
    const cutoff = date.toISOString();
    // SÉCURITÉ ($executeRawUnsafe) : NE JAMAIS interpoler de variable dans cette
    // query — uniquement des paramètres liés ($1, $2, ...). Le taggé $executeRaw
    // ne peut pas s'utiliser ici car le SQL est multi-instruction (WITH ...),
    // donc on garde Unsafe + variables 100% liées, vérifié à chaque changement.
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
    // SÉCURITÉ ($executeRawUnsafe) : NE JAMAIS interpoler de variable dans cette
    // query — uniquement des paramètres liés ($1 = cutoff, $2 = companyId), déjà
    // vérifié (audit 19/08/2026). Le taggé $executeRaw ne convient pas ici (SQL
    // multi-instruction WITH ...), on garde donc Unsafe + variables 100% liées.
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
    const { height } = page.getSize();
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
    if (report.trackingCoveragePct !== undefined) {
      field('Couverture GPS', `${report.trackingCoveragePct}%`);
    }

    // Section "signal GPS interrompu" : les trous détectés sont listés explicitement
    // (jamais une ligne droite silencieuse entre deux points éloignés dans le temps).
    if (report.signalGaps && report.signalGaps.length > 0) {
      y -= 12;
      title('Signal GPS interrompu', 12);
      y -= 4;
      const listedGaps = report.signalGaps.slice(0, 10);
      for (const gap of listedGaps) {
        const from = new Date(gap.fromTimestamp).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const to = new Date(gap.toTimestamp).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const mins = Math.round(gap.durationSec / 60);
        field(`Signal coupé ${from} → ${to}`, `${mins} min`);
      }
      if (report.signalGaps.length > 10) {
        field('…', `+${report.signalGaps.length - 10} autre(s) trou(s)`);
      }
    }

    const buf = await doc.save();
    return Buffer.from(buf);
  }

  /**
   * Ne garde que les chiffres d'un numéro de téléphone, puis compare les 9
   * DERNIERS chiffres (longueur d'un numéro mobile malgache sans indicatif :
   * 03X XX XXX XX = 9 chiffres). Permet de rapprocher deux formats du même
   * numéro sans connaître l'indicatif exact envoyé par l'opérateur/le SDK
   * Android (+261341234567, 0034 1234567, 034 12 345 67…) — comparer sur un
   * indicatif fixe casserait le rapprochement selon le format utilisé.
   */
  private static normalizePhoneTail(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    return digits.slice(-9);
  }

  /**
   * Ingestion d'une position reçue par relais SMS (audit terrain 2026-08-27) —
   * canal de secours pour les zones sans DATA ni WiFi mais avec réseau GSM
   * (fréquent en zone rurale à Madagascar). Le SMS ne transporte pas de
   * vehicleId (trop long) : le véhicule est résolu ici à partir du numéro
   * d'envoi (Driver.phone), rapproché via normalizePhoneTail.
   *
   * Réutilise savePosition() (dédoublonnage, téléportation, isolation
   * multi-tenant/source — TOUT le pipeline existant) plutôt que de dupliquer
   * cette logique : source='phone' comme n'importe quelle position émise par
   * un téléphone chauffeur, avec attributes.viaSms=true pour la traçabilité.
   */
  async ingestSmsRelayPosition(
    companyId: string,
    dto: SmsRelayPositionDto,
  ): Promise<{ status: 'ok' } | { status: 'no_driver_match' } | { status: 'rejected' }> {
    const targetTail = TrackingService.normalizePhoneTail(dto.senderPhone);
    if (targetTail.length < 9) {
      this.logger.warn(
        `SMS relay rejected: senderPhone "${dto.senderPhone}" too short after normalization`,
      );
      return { status: 'no_driver_match' };
    }

    const candidates = await this.prisma.driver.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        phone: { not: null },
        vehicleId: { not: null },
      },
      select: { id: true, phone: true, vehicleId: true },
    });
    const driver = candidates.find(
      (d) => d.phone && TrackingService.normalizePhoneTail(d.phone) === targetTail,
    );
    if (!driver || !driver.vehicleId) {
      this.logger.warn(
        `SMS relay: no active driver matches sender phone (company=${companyId}) — position not attributable`,
      );
      return { status: 'no_driver_match' };
    }

    const positionDto: UpdatePositionDto = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy,
      timestamp: dto.timestamp,
      vehicleId: driver.vehicleId,
    };

    const saved = await this.savePosition(driver.id, positionDto, companyId, 'phone', {
      viaSms: true,
    });
    if (!saved) {
      // savePosition() a déjà loggué la raison précise (dédoublonnée, véhicule
      // inactif, cross-tenant…) — pas de log dupliqué ici.
      return { status: 'rejected' };
    }
    return { status: 'ok' };
  }
}
