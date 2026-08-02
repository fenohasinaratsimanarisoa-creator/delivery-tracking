import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { UpdateFuelLogDto } from './dto/update-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';
import { CreateFuelPriceDto } from './dto/create-fuel-price.dto';
import { UpdateFuelPriceDto } from './dto/update-fuel-price.dto';
import { haversineDistance as haversineDistanceM } from '../../common/geo/geo.utils';
import {
  hasFuelAnomaly,
  withDerivedAnomaly,
} from '../../common/fuel/fuel-anomaly.utils';

// Valeurs initiales (seed) utilisées UNIQUEMENT tant que la company n'a pas configuré
// ses propres prix via l'app. Dès qu'une company enregistre ses prix (page Carburant →
// Prix carburant), ces valeurs sont persistées dans company_fuel_settings.default_fuel_prices
// et la saisie manuelle n'est plus nécessaire. Elles ne sont plus « le prix » en dur :
// elles ne servent que d'initialisation.
const DEFAULT_FUEL_PRICES: Record<string, number> = {
  essence: 5000,
  gasoil: 4900,
  diesel: 4900,
  electric: 0,
  hybrid: 3000,
};

// Seuil de bruit GPS : en dessous de 5m entre deux positions consécutives, on considère
// qu'il s'agit de bruit de réception (dérive à l'arrêt) et non d'un déplacement réel.
// Ce seuil est cohérent avec le scale d'accuracy utilisé dans detectTeleportation
// (backend tracking.service.ts) où une accuracy de 10m donne un scale de 1.
const GPS_NOISE_THRESHOLD_M = 5;

@Injectable()
export class FuelConsumptionService {
  private readonly logger = new Logger(FuelConsumptionService.name);
  private readonly fallbackThresholdPercent: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private notifications: NotificationsService,
    @Optional() @InjectQueue('fuel-analysis') private fuelAnalysisQueue: Queue,
    private trackingGateway: TrackingGateway,
  ) {
    this.fallbackThresholdPercent = this.configService.get<number>(
      'FUEL_ANOMALY_THRESHOLD_PERCENT',
      20,
    );
  }

  private async getCompanyThreshold(companyId: string): Promise<number> {
    const settings = await this.prisma.companyFuelSettings.findUnique({
      where: { companyId },
      select: { anomalyThreshold: true },
    });
    return settings?.anomalyThreshold ?? this.fallbackThresholdPercent;
  }

  private async getFuelPriceForDate(companyId: string, fuelType: string, date: Date): Promise<number> {
    const price = await this.prisma.fuelPriceHistory.findFirst({
      where: {
        companyId,
        fuelType: fuelType.toLowerCase(),
        effectiveFrom: { lte: date },
        OR: [
          { effectiveUntil: null },
          { effectiveUntil: { gte: date } },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (price) return price.pricePerLiter;

    // Pas de prix historique applicable → prix par défaut configurable de la company
    // (company_fuel_settings.default_fuel_prices, modifiable et persisté via l'app).
    // Upsert pour garantir une ligne de settings et un seed initial (valeurs héritées).
    const settings = await this.prisma.companyFuelSettings.upsert({
      where: { companyId },
      update: {},
      create: { companyId, defaultFuelPrices: DEFAULT_FUEL_PRICES },
    });
    const defaults = (settings.defaultFuelPrices as Record<string, number> | null) ?? DEFAULT_FUEL_PRICES;
    return defaults[fuelType.toLowerCase()] ?? 0;
  }

  async create(companyId: string, dto: CreateFuelLogDto) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, companyId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found in your company');

    const fuelLog = await this.prisma.fuelLog.create({
      data: {
        liters: dto.liters,
        kilometers: dto.kilometers,
        cost: dto.cost,
        fillDate: new Date(dto.fillDate),
        notes: dto.notes,
        vehicleId: dto.vehicleId,
        companyId,
      },
      include: { vehicle: true },
    });

    try {
      if (this.fuelAnalysisQueue) {
        await this.fuelAnalysisQueue.add('analyze', {
          fuelLogId: fuelLog.id,
          vehicleId: fuelLog.vehicleId,
          companyId,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Failed to dispatch fuel analysis job: ${e.message}`);
    }

    // Vérification croisée : distance GPS vs kilomètres saisis
    try {
      await this.crossCheckFuelLogWithGps(fuelLog, companyId);
    } catch (e: any) {
      this.logger.warn(`Cross-check failed for fuel log ${fuelLog.id}: ${e.message}`);
    }

    // anomalyFlag/anomalyReason sont dérivés en lecture (consumption OR gps) :
    // jamais stockés, jamais écrits par les détecteurs.
    const enriched = await this.prisma.fuelLog.findUnique({
      where: { id: fuelLog.id },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
    return withDerivedAnomaly(enriched);
  }

  async findAll(companyId: string, filter: FuelFilterDto) {
    const where: any = { companyId };
    if (filter.vehicleId) where.vehicleId = filter.vehicleId;

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.fuelLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fillDate: 'desc' },
        include: {
          vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        },
      }),
      this.prisma.fuelLog.count({ where }),
    ]);

    return {
      data: data.map((l) => withDerivedAnomaly(l)),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(companyId: string, id: string) {
    const log = await this.prisma.fuelLog.findFirst({
      where: { id, companyId },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
    if (!log) throw new NotFoundException('Fuel log not found');
    return withDerivedAnomaly(log)!;
  }

  async update(companyId: string, id: string, dto: UpdateFuelLogDto) {
    // Vérifie que le fuel log existe ET appartient à la company (même pattern que
    // vehicles.service.ts / deliveries.service.ts via findOne()).
    const existing = await this.findOne(companyId, id);

    const data: any = { ...dto };
    if (dto.fillDate) data.fillDate = new Date(dto.fillDate);

    // Si le véhicule est modifié, revérifie son appartenance à la company
    // (même logique que dans create()).
    if (dto.vehicleId && dto.vehicleId !== existing.vehicleId) {
      const vehicle = await this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, companyId, deletedAt: null },
      });
      if (!vehicle) throw new NotFoundException('Vehicle not found in your company');
    }

    const measuredChanged =
      (dto.liters !== undefined && dto.liters !== existing.liters) ||
      (dto.kilometers !== undefined && dto.kilometers !== existing.kilometers) ||
      (dto.fillDate !== undefined &&
        new Date(dto.fillDate).getTime() !== existing.fillDate.getTime()) ||
      (dto.vehicleId !== undefined && dto.vehicleId !== existing.vehicleId);

    // On efface les anciens flags avant relance du cross-check : les détecteurs ne
    // font que POSER leur flag à true si anomalie. Sans remise à zéro, un flag
    // obsolète resterait affiché après correction d'une erreur de saisie. Chaque
    // paire (consommation / GPS) est remise à zéro indépendamment — le champ dérivé
    // anomalyFlag est recalculé en lecture et ne se manipule jamais ici.
    if (measuredChanged) {
      data.consumptionAnomalyFlag = false;
      data.consumptionAnomalyReason = null;
      data.gpsAnomalyFlag = false;
      data.gpsAnomalyReason = null;
    }

    const updated = await this.prisma.fuelLog.update({
      where: { id },
      data,
      include: { vehicle: true },
    });

    // Recalcule le cross-check GPS à partir du nouveau kilométrage/distance GPS.
    try {
      if (measuredChanged) {
        await this.crossCheckFuelLogWithGps(updated, companyId);
      }
    } catch (e: any) {
      this.logger.warn(`Cross-check failed for fuel log ${updated.id}: ${e.message}`);
    }

    const enriched = await this.prisma.fuelLog.findUnique({
      where: { id: updated.id },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
    return withDerivedAnomaly(enriched);
  }

  async remove(companyId: string, id: string) {
    // Vérifie que le fuel log existe ET appartient à la company (même pattern que update()).
    await this.findOne(companyId, id);

    // DÉCISION : hard delete (prisma.fuelLog.delete), PAS de soft-delete avec deletedAt.
    // Justification (diagnostic schema.prisma) :
    //  - FuelLog ne possède PAS de champ `deletedAt`, contrairement à Vehicle/Delivery
    //    (soft-delete), et ne porte PAS le commentaire "Données comptables — jamais
    //    supprimées" présent sur MaintenanceRecord/DailyFuelReport/FuelPriceHistory.
    //  - Aucune table ne référence fuel_logs : DailyFuelReport est calculé depuis les
    //    positions GPS du véhicule (pas depuis les fuel logs) et les notifications ne
    //    portent qu'un lien URL. Un hard delete ne brise donc aucune clé étrangère.
    //  - findAll()/getConsumptionStats()/crossCheckFuelLogWithGps() ne filtrent pas sur
    //    deletedAt : un soft-delete exigerait de modifier ces méthodes existantes
    //    (interdit) pour exclure les logs supprimés des stats et du cross-check.
    //  - Comportement assumé : la suppression NE recalcule PAS rétroactivement les
    //    dailyFuelReport historiques — c'est acceptable pour un rapport historique
    //    indépendant du détail des pleins (distance GPS + consommation théorique).
    await this.prisma.fuelLog.delete({ where: { id } });
    return { message: 'Fuel log deleted' };
  }

  async getConsumptionStats(companyId: string, vehicleId?: string) {
    const where: any = { companyId };
    if (vehicleId) where.vehicleId = vehicleId;

    const logs = await this.prisma.fuelLog.findMany({
      where,
      include: { vehicle: true },
      orderBy: { fillDate: 'asc' },
    });

    const totalLiters = logs.reduce((sum, l) => sum + l.liters, 0);
    const totalKm = logs.reduce((sum, l) => sum + l.kilometers, 0);
    const totalCost = logs.reduce((sum, l) => sum + l.cost, 0);
    const anomalies = logs
      .filter((l) => hasFuelAnomaly(l))
      .map((l) => withDerivedAnomaly(l));

    return {
      totalLiters,
      totalKilometers: totalKm,
      totalCost,
      averageConsumption: totalKm > 0 ? (totalLiters / totalKm) * 100 : 0,
      anomalyCount: anomalies.length,
      anomalies,
      logCount: logs.length,
    };
  }

  async getDailyReports(companyId: string, reportDate?: string) {
    const where: any = { companyId };
    if (reportDate) {
      const d = new Date(reportDate);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      where.reportDate = { gte: d, lt: next };
    }
    return this.prisma.dailyFuelReport.findMany({
      where,
      orderBy: { reportDate: 'desc' },
      take: 100,
    });
  }

  // ----------------------------------------------------------------
  // GESTION DES PRIX CARBURANT — modifiables et persistés (plus de prix en dur)
  // ----------------------------------------------------------------

  /** Liste les prix par défaut (éditables) + l'historique des prix par company. */
  async getFuelPrices(companyId: string) {
    const history = await this.prisma.fuelPriceHistory.findMany({
      where: { companyId },
      orderBy: [{ fuelType: 'asc' }, { effectiveFrom: 'desc' }],
    });
    const settings = await this.prisma.companyFuelSettings.findUnique({
      where: { companyId },
      select: { defaultFuelPrices: true },
    });
    const defaults = (settings?.defaultFuelPrices as Record<string, number> | null) ?? DEFAULT_FUEL_PRICES;
    return { defaults, history };
  }

  /** Enregistre/remplace les prix par défaut de la company (par type de carburant). */
  async updateDefaultFuelPrices(companyId: string, prices: Record<string, number>) {
    const sanitized: Record<string, number> = {};
    for (const [key, value] of Object.entries(prices)) {
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) sanitized[key.toLowerCase()] = num;
    }
    await this.prisma.companyFuelSettings.upsert({
      where: { companyId },
      update: { defaultFuelPrices: sanitized },
      create: { companyId, defaultFuelPrices: sanitized },
    });
    return { defaults: sanitized };
  }

  /** Ajoute un prix dans l'historique et ferme l'entrée ouverte précédente du même type. */
  async createFuelPrice(companyId: string, dto: CreateFuelPriceDto) {
    const fuelType = dto.fuelType.toLowerCase();
    const effectiveFrom = new Date(dto.effectiveFrom);

    // Ferme l'entrée sans date de fin (effectiveUntil null) du même type qui précède ce prix,
    // pour garder une chaîne d'historique propre (chaque prix mène au suivant).
    await this.prisma.fuelPriceHistory.updateMany({
      where: { companyId, fuelType, effectiveUntil: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveUntil: new Date(effectiveFrom.getTime() - 1) },
    });

    return this.prisma.fuelPriceHistory.create({
      data: {
        companyId,
        fuelType,
        pricePerLiter: dto.pricePerLiter,
        effectiveFrom,
        ...(dto.effectiveUntil ? { effectiveUntil: new Date(dto.effectiveUntil) } : {}),
      },
    });
  }

  async updateFuelPrice(companyId: string, id: string, dto: UpdateFuelPriceDto) {
    const existing = await this.prisma.fuelPriceHistory.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Fuel price not found');

    const data: any = {};
    if (dto.fuelType !== undefined) data.fuelType = dto.fuelType.toLowerCase();
    if (dto.pricePerLiter !== undefined) data.pricePerLiter = dto.pricePerLiter;
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.effectiveUntil !== undefined) {
      data.effectiveUntil = dto.effectiveUntil ? new Date(dto.effectiveUntil) : null;
    }

    return this.prisma.fuelPriceHistory.update({ where: { id }, data });
  }

  async deleteFuelPrice(companyId: string, id: string) {
    const existing = await this.prisma.fuelPriceHistory.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Fuel price not found');
    await this.prisma.fuelPriceHistory.delete({ where: { id } });
    return { message: 'Fuel price deleted' };
  }

  @Cron(CronExpression.EVERY_DAY_AT_10PM)
  async generateDailyReports() {
    this.logger.log('Starting daily fuel report generation...');

    const companies = await this.prisma.company.findMany({ select: { id: true } });

    for (const company of companies) {
      try {
        await this.generateDailyReportForCompany(company.id, new Date());
      } catch (err: any) {
        this.logger.error(`Failed daily fuel report for company ${company.id}: ${err.message}`);
      }
    }

    this.logger.log('Daily fuel report generation complete.');
  }

  async generateDailyReportForCompanyOnDemand(companyId: string, dateStr?: string) {
    const date = dateStr ? new Date(dateStr) : new Date();
    await this.generateDailyReportForCompany(companyId, date);
  }

  /**
   * Calcule la fenêtre journalière en fuseau Afrique/Madagascar (UTC+3).
   * Le serveur tourne en UTC : le jour malgache commence à 21h UTC (J-1) et finit à 20h59 UTC (J).
   */
  private getMadagascarDayBounds(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setUTCHours(21, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 1);

    const end = new Date(date);
    end.setUTCHours(20, 59, 59, 999);
    end.setUTCDate(end.getUTCDate());

    return { start, end };
  }

  private async generateDailyReportForCompany(companyId: string, forDate?: Date) {
    const targetDate = forDate || new Date();

    const drivers = await this.prisma.driver.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: {
        id: true, firstName: true, lastName: true,
        vehicle: { select: { id: true, licensePlate: true, fuelType: true, theoreticalConsumption: true } },
      },
    });

    // Comportement du cron de 22h strictement inchangé : boucle sur TOUS les chauffeurs
    // actifs de la company, chacun recalculé via generateDailyReportForDriver() (même
    // logique que l'ancien corps de boucle, extrait sans modification de comportement).
    for (const driver of drivers) {
      await this.generateDailyReportForDriver(driver, companyId, targetDate);
    }
  }

  /**
   * Recalcule le DailyFuelReport d'UN SEUL chauffeur pour la journée donnée.
   * C'est la méthode utilisée par le flux temps réel : à chaque livraison marquée
   * `delivered`, un job de queue cible UNIQUEMENT le chauffeur de cette livraison —
   * jamais toute la company — pour éviter de recréer le coût du batch quotidien à
   * chaque livraison terminée.
   */
  async generateDailyReportForSingleDriver(companyId: string, driverId: string, date?: Date) {
    const targetDate = date || new Date();

    const driver = await this.prisma.driver.findFirst({
      where: { id: driverId, companyId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true,
        vehicle: { select: { id: true, licensePlate: true, fuelType: true, theoreticalConsumption: true } },
      },
    });

    if (!driver) {
      this.logger.warn(`generateDailyReportForSingleDriver: driver ${driverId} not found in company ${companyId}`);
      return;
    }

    await this.generateDailyReportForDriver(driver, companyId, targetDate);
  }

  /**
   * Calcule et upsert le DailyFuelReport d'un seul chauffeur (corps extrait de l'ancienne
   * boucle de generateDailyReportForCompany — refactor interne, résultat strictement
   * identique). Le upsert Prisma sur driverId_reportDate recalcule TOUJOURS la totalité
   * du jour : deux livraisons du même chauffeur terminées quasi simultanément produisent
   * deux jobs qui se recouvrent sans jamais accumuler de distance en double.
   */
  private async generateDailyReportForDriver(
    driver: {
      id: string;
      firstName: string;
      lastName: string;
      vehicle: { id: string; licensePlate: string; fuelType: string; theoreticalConsumption: number | null } | null;
    },
    companyId: string,
    targetDate: Date,
  ) {
    const bounds = this.getMadagascarDayBounds(targetDate);

    const positions = await this.prisma.gpsPosition.findMany({
      where: {
        driverId: driver.id,
        suspect: false,
        timestamp: { gte: bounds.start, lte: bounds.end },
      },
      orderBy: { timestamp: 'asc' },
      select: { latitude: true, longitude: true },
    });

    if (positions.length < 2) return;

    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
      const segDist = haversineDistanceM(
        positions[i - 1].latitude, positions[i - 1].longitude,
        positions[i].latitude, positions[i].longitude,
      );
      if (segDist >= GPS_NOISE_THRESHOLD_M) {
        totalDistance += segDist;
      }
    }

    const distanceKm = Math.round(totalDistance / 1000 * 100) / 100;
    if (distanceKm < 0.1) return;

    const vehicle = driver.vehicle;
    if (!vehicle) return;
    const fuelType = vehicle.fuelType?.toLowerCase() || 'essence';
    const consumption = vehicle?.theoreticalConsumption || 8;
    const pricePerLiter = await this.getFuelPriceForDate(companyId, fuelType, targetDate);
    const estimatedCost = Math.round(distanceKm * consumption / 100 * pricePerLiter * 100) / 100;

    const reportDate = new Date(Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()));
    await this.prisma.dailyFuelReport.upsert({
      where: {
        driverId_reportDate: {
          driverId: driver.id,
          reportDate,
        },
      },
      create: {
        reportDate,
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        vehicleId: vehicle.id,
        vehiclePlate: vehicle?.licensePlate || 'N/A',
        fuelType: fuelType,
        distanceKm,
        consumptionLPer100Km: consumption,
        estimatedCost,
        pricePerLiterUsed: pricePerLiter,
        companyId,
      },
      update: {
        distanceKm,
        estimatedCost,
        fuelType: fuelType,
        consumptionLPer100Km: consumption,
        vehiclePlate: vehicle?.licensePlate || 'N/A',
        pricePerLiterUsed: pricePerLiter,
      },
    });

    // Notifie la company connectée UNIQUEMENT après l'écriture effective en base : réutilise
    // le mécanisme 'dataUpdate' existant (broadcastDataUpdate → useDataUpdates côté front),
    // qui invalide automatiquement les queries React Query de FuelPage. Asynchrone de nature
    // (le job est déjà exécuté hors de la requête HTTP de complétion de livraison).
    this.trackingGateway.broadcastDataUpdate(companyId, 'fuelReport', {
      entity: 'fuelReport',
      driverId: driver.id,
      reportDate: reportDate.toISOString(),
    });
  }

  private async crossCheckFuelLogWithGps(fuelLog: any, companyId: string) {
    if (!fuelLog.kilometers || fuelLog.kilometers <= 0) return;

    // Trouver le dernier plein avant celui-ci pour le même véhicule
    const prevLog = await this.prisma.fuelLog.findFirst({
      where: { vehicleId: fuelLog.vehicleId, companyId, fillDate: { lt: fuelLog.fillDate } },
      orderBy: { fillDate: 'desc' },
      select: { fillDate: true },
    });

    const rawStart = prevLog?.fillDate || new Date(fuelLog.fillDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rawEnd = fuelLog.fillDate;

    // Normalisation des bornes au jour UTC (minuit), alignée sur dailyFuelReport.reportDate
    // qui est TOUJOURS minuit UTC (voir generateDailyReportForCompany, ligne ~350 :
    // new Date(Date.UTC(year, month, date))). Sans cette troncature, un plein précédent à
    // 14h30 exclurait le reportDate du jour J (minuit, antérieur à 14h30) de la période
    // gte/lte : la distance GPS de ce jour serait ignorée, sous-estimant gpsKm et risquant
    // une fausse anomalie sur un plein pourtant légitime. Inclure le jour entier du plein
    // précédent ET du plein courant sur-estime légèrement la distance GPS, ce qui est le
    // comportement le plus sûr : mieux vaut inclure un peu plus que déclencher une fausse
    // anomalie. (Même logique de commentaire documenté que GPS_NOISE_THRESHOLD_M ci-dessus.)
    const periodStart = new Date(Date.UTC(rawStart.getUTCFullYear(), rawStart.getUTCMonth(), rawStart.getUTCDate()));
    const periodEnd = new Date(Date.UTC(rawEnd.getUTCFullYear(), rawEnd.getUTCMonth(), rawEnd.getUTCDate()));

    const gpsDistance = await this.prisma.dailyFuelReport.aggregate({
      where: {
        companyId,
        vehicleId: fuelLog.vehicleId,
        reportDate: { gte: periodStart, lte: periodEnd },
      },
      _sum: { distanceKm: true },
    });

    const gpsKm = gpsDistance._sum?.distanceKm || 0;
    if (gpsKm <= 0) return;

    const manualKm = fuelLog.kilometers;
    const ratio = manualKm / gpsKm;

    // Seuil de tolérance : si le kilométrage saisi est > 3x la distance GPS, c'est suspect
    const CROSS_CHECK_THRESHOLD = 3;
    if (ratio > CROSS_CHECK_THRESHOLD) {
      // Ce détecteur n'écrit QUE sa propre paire (gpsAnomalyFlag/gpsAnomalyReason).
      // Il ne touche jamais aux champs consommation ni au champ dérivé anomalyFlag :
      // sinon il écraserait la détection concurrente du job 'analyze' (write-loss).
      await this.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: {
          gpsAnomalyFlag: true,
          gpsAnomalyReason: `Distance saisie (${manualKm}km) très supérieure à la distance GPS (${gpsKm.toFixed(1)}km) sur la période — rapport ×${ratio.toFixed(1)}`,
        },
      });
      await this.notifications.create(companyId, {
        type: NotificationType.fuel_anomaly,
        priority: NotificationPriority.high,
        title: 'Fuel Consumption Anomaly',
        message: `Vehicle ${fuelLog.vehicle?.licensePlate || fuelLog.vehicleId}: manual km (${manualKm}) vs GPS km (${gpsKm.toFixed(1)}) — ratio ${ratio.toFixed(1)}x`,
        link: `/fuel-consumption`,
        deliveryId: undefined,
      });
    }
  }}
