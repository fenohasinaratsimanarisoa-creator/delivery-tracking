import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, NotificationPriority, GpsDataQuality } from '@prisma/client';
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
import { UpdateDefaultFuelPricesDto } from './dto/update-default-fuel-prices.dto';
import { computeFilteredDistance, haversineDistance } from '../../common/geo/geo.utils';
import { hasFuelAnomaly, withDerivedAnomaly } from '../../common/fuel/fuel-anomaly.utils';

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

  /**
   * Normalise le `fuelType` D'UN VÉHICULE vers le token canonique du système de
   * prix (essence | diesel | electric | hybrid). Le formulaire véhicule stocke
   * des libellés français capitalisés / accentué : 'Essence', 'Diesel',
   * 'Hybride Essence', 'Hybride Diesel', 'Électrique' (FleetPage).
   * Sans cette normalisation, un véhicule non littéralement 'diesel' (ex.
   * 'Hybride Diesel', 'Électrique') résolvait un prix de 0 Ar via
   * `defaults[fuelType.toLowerCase()] ?? 0` : les clés du dictionnaire de prix
   * sont des tokens anglais, aucune ne correspond → coût estimé 0 même pour un
   * véhicule thermique. `electric` reste à 0 Ar (prix par défaut délibéré).
   */
  private normalizeFuelType(raw?: string | null): string {
    const s = (raw ?? 'essence')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (s.includes('elect')) return 'electric'; // 'electrique' (accentué) et 'electric'
    if (s.includes('gasoil') || s.includes('gazoil')) return 'gasoil'; // historique gasoil distinct
    if (s.includes('diesel')) return 'diesel';
    if (s.includes('essence')) return 'essence';
    if (s.includes('hybr')) return 'hybrid';
    return 'essence';
  }

  private async getFuelPriceForDate(
    companyId: string,
    fuelType: string,
    date: Date,
  ): Promise<number> {
    // Token canonique : le formulaire véhicule stocke 'Hybride Diesel',
    // 'Électrique', 'Essence'… qui ne sont PAS les clés du dictionnaire de prix.
    const canonical = this.normalizeFuelType(fuelType);
    const price = await this.prisma.fuelPriceHistory.findFirst({
      where: {
        companyId,
        fuelType: canonical,
        effectiveFrom: { lte: date },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: date } }],
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
    const defaults =
      (settings.defaultFuelPrices as Record<string, number> | null) ?? DEFAULT_FUEL_PRICES;
    return defaults[canonical] ?? 0;
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
      include: {
        vehicle: {
          include: { driver: { select: { userId: true } } },
        },
      },
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
      data.gpsCoverageInsufficientFlag = false;
      data.gpsCoverageInsufficientReason = null;
    }

    const updated = await this.prisma.fuelLog.update({
      where: { id },
      data,
      include: {
        vehicle: {
          include: { driver: { select: { userId: true } } },
        },
      },
    });

    // Re-déclenche le job 'analyze' pour recalculer calculatedConsumption et
    // l'anomalie de consommation théorique à partir des valeurs corrigées (même
    // pattern que create()). Sans ce ré-enqueue, calculatedConsumption resterait
    // figé sur l'ancienne saisie après une correction.
    try {
      if (measuredChanged && this.fuelAnalysisQueue) {
        await this.fuelAnalysisQueue.add('analyze', {
          fuelLogId: updated.id,
          vehicleId: updated.vehicleId,
          companyId,
        });
      }
    } catch (e: any) {
      this.logger.warn(`Failed to dispatch fuel analysis job: ${e.message}`);
    }

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
    const anomalies = logs.filter((l) => hasFuelAnomaly(l)).map((l) => withDerivedAnomaly(l));

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

  /**
   * Diagnostic des données GPS brutes d'une journée, GROUPÉ par véhicule —
   * route GET /fuel-consumption/gps-diagnostics?date=YYYY-MM-DD.
   *
   * Ce endpoint ne CALCULE AUCUNE donnée : il NE FAIT QUE refléter ce qui est
   * réellement stocké dans gps_positions, pour expliquer pourquoi un rapport
   * sous-estime la distance réelle (app fermée / arrière-plan → gaps > 60 s,
   * positions suspectées exclues, aucun fix du tout, vitesse jamais remontée,
   * etc.) et croiser :
   *  - rawDistanceKm : distance en ligne droite (haversine) sur les positions
   *    validées (non suspectes) — borne haute accessible depuis les fixes ;
   *  - filteredDistanceKm : distance APRÈS le filtre de bruit (le même
   *    computeFilteredDistance que le DailyFuelReport) ;
   *  - reportDistanceKm : ce que le DailyFuelReport du jour a réellement stocké.
   *
   * Aucun chiffre inventé : si les fixes manquent, la distance brute est elle
   * aussi incomplète — seul le signal de couverture (avgGapSec/longGapCount/
   * coveragePercent) explique le sous-comptage.
   */
  async getGpsDiagnostics(companyId: string, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const bounds = this.getMadagascarDayBounds(targetDate);

    const positions = await this.prisma.gpsPosition.findMany({
      where: { companyId, timestamp: { gte: bounds.start, lte: bounds.end } },
      orderBy: { timestamp: 'asc' },
      select: {
        latitude: true,
        longitude: true,
        vehicleId: true,
        driverId: true,
        accuracy: true,
        speed: true,
        timestamp: true,
        suspect: true,
      },
    });

    const byVehicle = new Map<
      string,
      Array<{
        latitude: number;
        longitude: number;
        accuracy?: number | null;
        speed?: number | null;
        timestamp: Date;
        suspect: boolean;
        driverId?: string | null;
      }>
    >();
    let unattributed = 0;
    for (const p of positions) {
      if (!p.vehicleId) {
        unattributed++;
        continue;
      }
      const group = byVehicle.get(p.vehicleId) ?? [];
      group.push({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        speed: p.speed,
        timestamp: p.timestamp,
        suspect: p.suspect,
        driverId: p.driverId,
      });
      byVehicle.set(p.vehicleId, group);
    }

    const vehicleIds = [...byVehicle.keys()];

    // driverId du rapport : dernier driver NON NULL du groupe (même règle que
    // generateDailyReportForVehicle).
    const driverIds = new Set<string>();
    for (const group of byVehicle.values()) {
      const d = [...group].reverse().find((p) => p.driverId)?.driverId;
      if (d) driverIds.add(d);
    }

    const [vehicles, drivers, reports] = await Promise.all([
      vehicleIds.length
        ? this.prisma.vehicle.findMany({
            where: { id: { in: vehicleIds }, companyId },
            select: {
              id: true,
              licensePlate: true,
              fuelType: true,
              theoreticalConsumption: true,
            },
          })
        : Promise.resolve([]),
      driverIds.size
        ? this.prisma.driver.findMany({
            where: { id: { in: [...driverIds] }, companyId },
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
      this.prisma.dailyFuelReport.findMany({
        where: { companyId, reportDate: this.dateUtcWindow(targetDate) },
        select: { vehicleId: true, distanceKm: true, fuelType: true, pricePerLiterUsed: true },
      }),
    ]);

    const plateById = new Map(vehicles.map((v) => [v.id, v.licensePlate]));
    const vehicleFuel = new Map(
      vehicles.map((v) => [
        v.id,
        { fuelType: v.fuelType, theoreticalConsumption: v.theoreticalConsumption },
      ]),
    );
    const driverById = new Map(drivers.map((d) => [d.id, d]));
    const reportByVehicle = new Map(reports.map((r) => [r.vehicleId, r]));

    const vehiclesDiag = [...byVehicle.entries()].map(([vehicleId, group]) => {
      const valid = group.filter((p) => !p.suspect);
      const suspectCount = group.length - valid.length;

      let rawKm = 0;
      let filteredKm = 0;
      for (let i = 1; i < valid.length; i++) {
        const a = valid[i - 1];
        const b = valid[i];
        rawKm += haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude) / 1000;
      }
      filteredKm = computeFilteredDistance(valid) / 1000;

      let spanSec = 0;
      let avgGapSec = 0;
      let maxGapSec = 0;
      let longGapCount = 0;
      let coveredGapSec = 0;
      if (valid.length >= 2) {
        spanSec =
          (valid[valid.length - 1].timestamp.getTime() - valid[0].timestamp.getTime()) / 1000;
        const gaps: number[] = [];
        for (let i = 1; i < valid.length; i++) {
          gaps.push((valid[i].timestamp.getTime() - valid[i - 1].timestamp.getTime()) / 1000);
        }
        avgGapSec = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        maxGapSec = Math.max(...gaps);
        longGapCount = gaps.filter((g) => g > 60).length;
        // Couverture "densité réelle" : la somme des gaps <= 300 s (5 min de
        // tolérance, cohérent avec l'échantillonnage mobile 3-20 s) est considérée
        // couverte ; au-delà de 300 s, seules les 300 premières secondes comptent
        // (le reste du trou = période sans donnée fiable). Contrairement à
        // spanSec/86400, un trou au milieu de la période est bien pénalisé.
        coveredGapSec = gaps.reduce((acc, g) => acc + Math.min(g, 300), 0);
      }

      const accuracies = valid.map((p) => p.accuracy).filter((a): a is number => a != null);
      const speeds = valid.map((p) => p.speed).filter((s): s is number => s != null);
      const accuracyMin = accuracies.length ? Math.min(...accuracies) : null;
      const accuracyMax = accuracies.length ? Math.max(...accuracies) : null;
      const accuracyAvg = accuracies.length
        ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length
        : null;
      const speedMaxMs = speeds.length ? Math.max(...speeds) : null;
      const movingCount = speeds.filter((s) => s > 1).length;

      const lastDriver = [...group].reverse().find((p) => p.driverId)?.driverId;
      const driver = lastDriver ? driverById.get(lastDriver) : undefined;
      const vehFuel = vehicleFuel.get(vehicleId);
      const report = reportByVehicle.get(vehicleId);

      return {
        vehicleId,
        vehiclePlate: plateById.get(vehicleId) ?? 'N/A',
        driverId: driver?.id ?? null,
        driverName: driver ? `${driver.firstName} ${driver.lastName}` : null,
        fuelType: vehFuel ? this.normalizeFuelType(vehFuel.fuelType) : null,
        vehicleFuelTypeRaw: vehFuel?.fuelType ?? null,
        theoreticalConsumption: vehFuel?.theoreticalConsumption ?? null,
        reportFuelType: report?.fuelType ?? null,
        reportPricePerLiter: report?.pricePerLiterUsed ?? null,
        fixCount: group.length,
        validCount: valid.length,
        suspectCount,
        spanSec: Math.round(spanSec),
        avgGapSec: Math.round(avgGapSec),
        maxGapSec: Math.round(maxGapSec),
        longGapCount,
        coveragePercent:
          spanSec > 0 ? Math.min(100, Math.round((coveredGapSec / spanSec) * 100)) : 0,
        rawDistanceKm: Math.round(rawKm * 100) / 100,
        filteredDistanceKm: Math.round(filteredKm * 100) / 100,
        reportDistanceKm: report?.distanceKm ?? null,
        accuracyMin,
        accuracyMax,
        accuracyAvg: accuracyAvg != null ? Math.round(accuracyAvg * 10) / 10 : null,
        speedMaxMs: speedMaxMs != null ? Math.round(speedMaxMs * 10) / 10 : null,
        movingCount,
        speedReportedCount: speeds.length,
      };
    });

    return {
      date: targetDate.toISOString().slice(0, 10),
      bounds: { start: bounds.start.toISOString(), end: bounds.end.toISOString() },
      totalPositions: positions.length,
      unattributedPositions: unattributed,
      vehicles: vehiclesDiag,
    };
  }

  /** Fenêtre [minuit UTC, minuit UTC + 1j) d'un jour — alignée sur dailyFuelReport.reportDate. */
  private dateUtcWindow(date: Date): { gte: Date; lt: Date } {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    return { gte: start, lt: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
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
    const defaults =
      (settings?.defaultFuelPrices as Record<string, number> | null) ?? DEFAULT_FUEL_PRICES;
    return { defaults, history };
  }

  /** Enregistre/remplace les prix par défaut de la company (par type de carburant). */
  async updateDefaultFuelPrices(companyId: string, prices: UpdateDefaultFuelPricesDto) {
    // Clés et valeurs déjà validées par le DTO (whitelist des types de carburant +
    // bornes @Min(0)/@Max(50000)) : le filtrage manuel Object.entries est retiré.
    const sanitized: Record<string, number> = {};
    for (const [key, value] of Object.entries(prices)) {
      if (value !== undefined) sanitized[key] = value;
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
    const effectiveUntil = dto.effectiveUntil ? new Date(dto.effectiveUntil) : null;

    // Ferme l'entrée sans date de fin (effectiveUntil null) du même type qui précède ce prix,
    // pour garder une chaîne d'historique propre (chaque prix mène au suivant).
    await this.prisma.fuelPriceHistory.updateMany({
      where: { companyId, fuelType, effectiveUntil: null, effectiveFrom: { lt: effectiveFrom } },
      data: { effectiveUntil: new Date(effectiveFrom.getTime() - 1) },
    });

    // Garde-fou anti-chevauchement : toute entrée existante (même déjà fermée) dont la plage
    // [effectiveFrom, effectiveUntil ?? +∞] chevauche [effectiveFrom, effectiveUntil ?? +∞] du
    // nouveau prix est refusée. Deux plages [a,b] et [c,d] se chevauchent si a <= d ET c <= b
    // (borne nulle = +∞). L'entrée ouverte qui précède a déjà été fermée ci-dessus à
    // effectiveFrom - 1ms : elle n'est donc pas comptée comme chevauchement.
    const overlapping = await this.prisma.fuelPriceHistory.findFirst({
      where: {
        companyId,
        fuelType,
        // existing.effectiveFrom <= nouveau effectiveUntil (null = +∞ → condition toujours vraie)
        ...(effectiveUntil ? { effectiveFrom: { lte: effectiveUntil } } : {}),
        // existing.effectiveUntil >= nouveau effectiveFrom (null = +∞ → toujours vrai)
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: effectiveFrom } }],
      },
    });

    if (overlapping) {
      const existingRange = `${overlapping.effectiveFrom.toISOString()} → ${
        overlapping.effectiveUntil ? overlapping.effectiveUntil.toISOString() : '∞'
      }`;
      throw new BadRequestException(
        `Fuel price for "${fuelType}" overlaps the existing range [${existingRange}]. ` +
          `Close or remove it before creating an overlapping price.`,
      );
    }

    return this.prisma.fuelPriceHistory.create({
      data: {
        companyId,
        fuelType,
        pricePerLiter: dto.pricePerLiter,
        effectiveFrom,
        ...(effectiveUntil ? { effectiveUntil } : {}),
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
      select: { id: true, firstName: true, lastName: true },
    });

    for (const driver of drivers) {
      await this.generateDailyReportForDriver(driver, companyId, targetDate);
    }

    // Boucle AUSSI sur les véhicules actifs SANS chauffeur actuellement assigné :
    // sans cette boucle, un véhicule temporairement désassigné n'aurait JAMAIS de
    // DailyFuelReport et crossCheckFuelLogWithGps() ne pourrait jamais détecter
    // d'anomalie sur ses pleins (la somme distanceKm du véhicule serait nulle).
    // Pour ces véhicules, le rapport est généré depuis les positions par vehicleId
    // directement (peu importe le driverId présent dessus).
    const unassignedVehicles = await this.prisma.vehicle.findMany({
      where: { companyId, deletedAt: null, isActive: true, driver: { is: null } },
      select: { id: true },
    });

    for (const vehicle of unassignedVehicles) {
      await this.generateDailyReportForVehicle(vehicle.id, companyId, targetDate);
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
      select: { id: true, firstName: true, lastName: true },
    });

    if (!driver) {
      this.logger.warn(
        `generateDailyReportForSingleDriver: driver ${driverId} not found in company ${companyId}`,
      );
      return;
    }

    await this.generateDailyReportForDriver(driver, companyId, targetDate);
  }

  /**
   * Calcule et upsert les DailyFuelReport d'un chauffeur pour la journée donnée,
   * UN rapport PAR (driverId, vehicleId, reportDate).
   *
   * Avant cette réécriture, TOUT le kilométrage GPS du jour était attribué au
   * véhicule COURANT du chauffeur (driver.vehicle), même si des positions avaient
   * été enregistrées avec un vehicleId différent (changement de véhicule en cours
   * de journée). Désormais les positions sont GROUPÉES par vehicleId réellement
   * présent sur chaque ligne gps_positions, et chaque groupe produit son propre
   * rapport avec les caractéristiques (fuelType, consommation théorique, prix) du
   * VÉHICULE DU GROUPE — jamais celles de driver.vehicle si celui-ci diffère.
   * Le upsert sur driverId_vehicleId_reportDate recalcule TOUJOURS la totalité du
   * jour : deux livraisons du même chauffeur terminées quasi simultanément produisent
   * deux jobs qui se recouvrent sans jamais accumuler de distance en double.
   */
  private async generateDailyReportForDriver(
    driver: { id: string; firstName: string; lastName: string },
    companyId: string,
    targetDate: Date,
  ) {
    const bounds = this.getMadagascarDayBounds(targetDate);

    const positions = await this.prisma.gpsPosition.findMany({
      where: {
        driverId: driver.id,
        companyId,
        suspect: false,
        timestamp: { gte: bounds.start, lte: bounds.end },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        latitude: true,
        longitude: true,
        vehicleId: true,
        accuracy: true,
        speed: true,
        timestamp: true,
      },
    });

    // GROUP BY par vehicleId côté applicatif : chaque véhicule réellement utilisé ce
    // jour produit son propre report (un chauffeur peut changer de véhicule à
    // midi : les km du matin restent attribués au véhicule du matin).
    const byVehicle = new Map<
      string,
      Array<{
        latitude: number;
        longitude: number;
        accuracy?: number | null;
        speed?: number | null;
        timestamp?: Date;
      }>
    >();
    for (const pos of positions) {
      const group = byVehicle.get(pos.vehicleId) ?? [];
      group.push({
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy: pos.accuracy,
        speed: pos.speed,
        timestamp: pos.timestamp,
      });
      byVehicle.set(pos.vehicleId, group);
    }

    for (const [vehicleId, vehiclePositions] of byVehicle) {
      await this.upsertDailyReportForVehicleGroup(
        driver,
        companyId,
        targetDate,
        vehicleId,
        vehiclePositions,
      );
    }
  }

  /**
   * Génère le DailyFuelReport d'un véhicule SANS chauffeur actuellement assigné,
   * à partir de ses positions GPS du jour par vehicleId directement. Le driverId
   * présent sur les positions n'importe pas ici : le but est que le référentiel
   * GPS du véhicule reste complet pour crossCheckFuelLogWithGps(). Le driverId du
   * rapport est celui de la position la plus récente du groupe (le rapport reste
   * attribué à un driver réel, la FK l'exige).
   */
  private async generateDailyReportForVehicle(
    vehicleId: string,
    companyId: string,
    targetDate: Date,
  ) {
    const bounds = this.getMadagascarDayBounds(targetDate);

    const positions = await this.prisma.gpsPosition.findMany({
      where: {
        vehicleId,
        companyId,
        suspect: false,
        timestamp: { gte: bounds.start, lte: bounds.end },
      },
      orderBy: { timestamp: 'asc' },
      select: {
        latitude: true,
        longitude: true,
        driverId: true,
        accuracy: true,
        speed: true,
        timestamp: true,
      },
    });

    if (positions.length === 0) return;

    // driverId est NULLABLE depuis 20260805183000 : une position peut exister sans
    // chauffeur assigné au moment du fix. Pour le DailyFuelReport (driverId NOT NULL),
    // on attribue le rapport au dernier driver NON NULL présent sur le véhicule ce
    // jour ; si TOUTES les positions sont null-driver, aucun rapport ne peut être
    // rattaché à un chauffeur (ligne DailyFuelReport impossible) → on saute. La
    // distance GPS du véhicule est calculée sur TOUTES ses positions (y compris
    // null-driver) : elles restent donc comptées dans le référentiel par-véhicule.
    const reportDriverId = [...positions].reverse().find((p) => p.driverId)?.driverId ?? null;
    if (!reportDriverId) return;

    const lastDriver = await this.prisma.driver.findUnique({
      where: { id: reportDriverId },
      select: { firstName: true, lastName: true },
    });

    await this.upsertDailyReportForVehicleGroup(
      {
        id: reportDriverId,
        firstName: lastDriver?.firstName ?? '',
        lastName: lastDriver?.lastName ?? '',
      },
      companyId,
      targetDate,
      vehicleId,
      positions.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        speed: p.speed,
        timestamp: p.timestamp,
      })),
    );
  }

  /**
   * Corps commun : calcule la distance d'un groupe de positions d'un (driver, vehicle, jour)
   * puis upsert le DailyFuelReport correspondant.
   */
  private async upsertDailyReportForVehicleGroup(
    driver: { id: string; firstName: string; lastName: string },
    companyId: string,
    targetDate: Date,
    vehicleId: string,
    positions: Array<{
      latitude: number;
      longitude: number;
      accuracy?: number | null;
      speed?: number | null;
      timestamp?: Date;
    }>,
  ) {
    let distanceKm = 0;
    let gpsDataQuality: GpsDataQuality = GpsDataQuality.insufficient;

    if (positions.length >= 2) {
      // Distance filtrée par bruit PONDÉRÉ par l'accuracy moyenne de chaque segment
      // ET plafonné (computeFilteredDistance, source unique dans geo.utils — même
      // logique que calculateDistance du rapport de trajet). La RÈGLE VITESSE compte
      // intégralement tout segment où une extrémité est en mouvement (speed > 1 m/s) :
      // les segments courts d'une circulation lente en ville ne sont plus effacés.
      // Un téléphone à l'arrêt (accuracy 10-50m) dérive de plusieurs mètres : le seuil
      // pondéré (max 7,5m) filtre toujours cette dérive quand la vitesse ≈ 0.
      const totalDistance = computeFilteredDistance(positions);
      const computedKm = Math.round((totalDistance / 1000) * 100) / 100;
      // Données GPS exploitables uniquement si un déplacement est mesurable (>= 0.1 km).
      if (computedKm >= 0.1) {
        distanceKm = computedKm;
        gpsDataQuality = GpsDataQuality.sufficient;
      }

      // Signal de couverture clairsemée : quand les fixes sont trop rares (app fermée,
      // arrière-plan long, GPS coupé), la distance calculée sous-estime la réalité.
      // On ne change pas la valeur (impossible à reconstruire), mais on laisse une
      // trace en log pour diagnostiquer le sous-comptage plutôt que de le masquer.
      if (
        positions.length >= 3 &&
        positions[0].timestamp &&
        positions[positions.length - 1].timestamp
      ) {
        const firstTs = positions[0].timestamp.getTime();
        const lastTs = positions[positions.length - 1].timestamp!.getTime();
        const spanSec = (lastTs - firstTs) / 1000;
        if (spanSec > 0) {
          const avgGapSec = spanSec / (positions.length - 1);
          if (avgGapSec > 60) {
            this.logger.warn(
              `[fuel-report] Coverage sparse: vehicle=${vehicleId} driver=${driver.id} ` +
                `positions=${positions.length} spanSec=${Math.round(spanSec)} avgGapSec=${Math.round(avgGapSec)} ` +
                `distanceKm=${computedKm.toFixed(2)} — distance may undercount`,
            );
          }
        }
      }
    }

    // Sinon (positions.length < 2 OU distance < 0.1 km) : le rapport est CRÉÉ quand
    // même avec distanceKm=0 et gpsDataQuality='insufficient'. Sans cette création,
    // le (vehicle, jour) serait absent du référentiel GPS agrégé par
    // crossCheckFuelLogWithGps, réduisant silencieusement le kilométrage de référence.
    //
    // Caractéristiques du VÉHICULE DE CE GROUPE (jamais driver.vehicle) : si un
    // chauffeur a roulé sur V1 le matin puis V2 l'après-midi, les km de V1 sont
    // chiffrés avec le fuelType/consommation/prix de V1, pas avec ceux de V2.
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { licensePlate: true, fuelType: true, theoreticalConsumption: true },
    });
    if (!vehicle) return;

    const fuelType = this.normalizeFuelType(vehicle.fuelType);
    const consumption = vehicle.theoreticalConsumption || 8;
    const pricePerLiter = await this.getFuelPriceForDate(companyId, fuelType, targetDate);
    const estimatedCost =
      Math.round(((distanceKm * consumption) / 100) * pricePerLiter * 100) / 100;

    const reportDate = new Date(
      Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()),
    );
    await this.prisma.dailyFuelReport.upsert({
      where: {
        driverId_vehicleId_reportDate: {
          driverId: driver.id,
          vehicleId,
          reportDate,
        },
      },
      create: {
        reportDate,
        driverId: driver.id,
        driverName: `${driver.firstName} ${driver.lastName}`,
        vehicleId,
        vehiclePlate: vehicle.licensePlate || 'N/A',
        fuelType,
        distanceKm,
        gpsDataQuality,
        consumptionLPer100Km: consumption,
        estimatedCost,
        pricePerLiterUsed: pricePerLiter,
        companyId,
      },
      update: {
        distanceKm,
        gpsDataQuality,
        estimatedCost,
        fuelType,
        consumptionLPer100Km: consumption,
        vehiclePlate: vehicle.licensePlate || 'N/A',
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
      vehicleId,
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

    const rawStart =
      prevLog?.fillDate || new Date(fuelLog.fillDate.getTime() - 30 * 24 * 60 * 60 * 1000);
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
    const periodStart = new Date(
      Date.UTC(rawStart.getUTCFullYear(), rawStart.getUTCMonth(), rawStart.getUTCDate()),
    );
    const periodEnd = new Date(
      Date.UTC(rawEnd.getUTCFullYear(), rawEnd.getUTCMonth(), rawEnd.getUTCDate()),
    );

    const gpsDistance = await this.prisma.dailyFuelReport.aggregate({
      where: {
        companyId,
        vehicleId: fuelLog.vehicleId,
        reportDate: { gte: periodStart, lte: periodEnd },
      },
      _sum: { distanceKm: true },
    });

    const gpsKm = gpsDistance._sum?.distanceKm || 0;
    const manualKm = fuelLog.kilometers;

    if (gpsKm <= 0) {
      // Aucune donnée GPS exploitable sur la période (GPS téléphone coupé, permission
      // refusée, traceur physique débranché/hors ligne, ou rapports jamais générés) :
      // le kilométrage saisi est TOTALEMENT invérifiable. Avant cette correction, la
      // fonction retournait SILENCIEUSEMENT — un plein sans aucune trace GPS devenait
      // indistinguable d'un plein cohérent (faille de fraude). On émet désormais un
      // signal explicite d'« impossibilité de vérifier », distinct d'une anomalie
      // confirmée (sémantique ≠ gpsAnomalyFlag), via une paire de champs dédiée + une
      // notification de priorité medium. On n'écrit/ne notifie que si le flag n'est pas
      // déjà posé : éviter les écritures/notifications redondantes à chaque create/update.
      const reason = `Aucune position GPS enregistrée pour ce véhicule entre ${periodStart.toISOString().slice(0, 10)} et ${periodEnd.toISOString().slice(0, 10)} — kilométrage saisi non vérifiable (${manualKm} km déclarés).`;
      if (!fuelLog.gpsCoverageInsufficientFlag) {
        await this.prisma.fuelLog.update({
          where: { id: fuelLog.id },
          data: {
            gpsCoverageInsufficientFlag: true,
            gpsCoverageInsufficientReason: reason,
          },
        });
        await this.notifications.create(companyId, {
          type: NotificationType.fuel_gps_coverage_missing,
          priority: NotificationPriority.medium,
          title: 'Couverture GPS insuffisante',
          message:
            `Vehicle ${fuelLog.vehicle?.licensePlate || fuelLog.vehicleId}: aucun kilométrage GPS vérifiable entre ` +
            `${periodStart.toISOString().slice(0, 10)} et ${periodEnd.toISOString().slice(0, 10)} (${manualKm} km déclarés).`,
          link: `/fuel-consumption`,
          deliveryId: undefined,
          userId: fuelLog.vehicle?.driver?.userId ?? undefined,
        });
      }
      return;
    }

    // gpsKm > 0 : la vérification est possible. Si un flag « couverture insuffisante »
    // obsolète traînait d'un check précédent (ex. le GPS a été backfillé / le rapport
    // généré depuis), on le remet à zéro — ne pas laisser un flag périmé (même logique
    // que le reset des flags dans update()).
    if (fuelLog.gpsCoverageInsufficientFlag) {
      await this.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: {
          gpsCoverageInsufficientFlag: false,
          gpsCoverageInsufficientReason: null,
        },
      });
    }

    const ratio = manualKm / gpsKm;

    // Seuil de tolérance configurable : CompanyFuelSettings.crossCheckThreshold
    // (ratio kilométrage saisi / distance GPS), défaut 1.3 = 130%.
    //
    // Pourquoi l'ancien seuil en dur de 3 (= 300%) était bien trop permissif :
    // il autorisait une distance saisie jusqu'à 3x la distance GPS avant d'être
    // signalée, soit jusqu'à 2.9x de survalorisation INVISIBLE (un ratio de 2.99
    // passait sans alerte). Une telle marge correspond en pratique à des litres
    // non comptabilisés / kilométrages fictifs qui restaient silencieux. 1.3 laisse
    // une marge réaliste pour les imprécisions GPS (±30%) sans laisser passer les
    // écarts manifestes (à 2x, l'anomalie est désormais flaggée).
    const settings = await this.prisma.companyFuelSettings.findUnique({
      where: { companyId },
      select: { crossCheckThreshold: true },
    });
    const crossCheckThreshold = settings?.crossCheckThreshold ?? 1.3;

    if (ratio > crossCheckThreshold) {
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
        userId: fuelLog.vehicle?.driver?.userId ?? undefined,
      });
    }
  }
}
