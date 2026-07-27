import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';
import { haversineDistance as haversineDistanceM } from '../../common/geo/geo.utils';

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
        AND: [
          { effectiveUntil: null },
          { OR: [{ effectiveUntil: { gte: date } }, { effectiveUntil: null }] },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (price) return price.pricePerLiter;
    return DEFAULT_FUEL_PRICES[fuelType.toLowerCase()] || 5000;
  }

  async create(companyId: string, dto: CreateFuelLogDto) {
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

    return this.prisma.fuelLog.findUnique({
      where: { id: fuelLog.id },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
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
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(companyId: string, id: string) {
    const log = await this.prisma.fuelLog.findFirst({
      where: { id, companyId },
      include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
    });
    if (!log) throw new NotFoundException('Fuel log not found');
    return log;
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
    const anomalies = logs.filter((l) => l.anomalyFlag);

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

  /**
   * Pour le cron global (22h UTC), utilise la date UTC directement — cohérent avec
   * l'heure de déclenchement (22h UTC = 01h EAT le lendemain).
   */
  private getUTCDayBounds(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }

  private async generateDailyReportForCompany(companyId: string, forDate?: Date) {
    const targetDate = forDate || new Date();
    const bounds = this.getMadagascarDayBounds(targetDate);

    const drivers = await this.prisma.driver.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      select: {
        id: true, firstName: true, lastName: true,
        vehicle: { select: { id: true, licensePlate: true, fuelType: true, theoreticalConsumption: true } },
      },
    });

    // Seuil de bruit GPS : en dessous de 5m entre deux positions consécutives, on considère
    // qu'il s'agit de bruit de réception (dérive à l'arrêt) et non d'un déplacement réel.
    // Ce seuil est cohérent avec le scale d'accuracy utilisé dans detectTeleportation
    // (backend tracking.service.ts) où une accuracy de 10m donne un scale de 1.
    const GPS_NOISE_THRESHOLD_M = 5;

    for (const driver of drivers) {
      const positions = await this.prisma.gpsPosition.findMany({
        where: {
          driverId: driver.id,
          suspect: false,
          timestamp: { gte: bounds.start, lte: bounds.end },
        },
        orderBy: { timestamp: 'asc' },
        select: { latitude: true, longitude: true },
      });

      if (positions.length < 2) continue;

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
      if (distanceKm < 0.1) continue;

      const vehicle = driver.vehicle;
      const fuelType = vehicle?.fuelType?.toLowerCase() || 'essence';
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
    }
  }

  private async crossCheckFuelLogWithGps(fuelLog: any, companyId: string) {
    if (!fuelLog.kilometers || fuelLog.kilometers <= 0) return;

    // Trouver le dernier plein avant celui-ci pour le même véhicule
    const prevLog = await this.prisma.fuelLog.findFirst({
      where: { vehicleId: fuelLog.vehicleId, companyId, fillDate: { lt: fuelLog.fillDate } },
      orderBy: { fillDate: 'desc' },
      select: { fillDate: true },
    });

    const periodStart = prevLog?.fillDate || new Date(fuelLog.fillDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const periodEnd = fuelLog.fillDate;

    // Sommer les distances GPS sur la période entre les deux pleins
    const gpsDistance = await this.prisma.dailyFuelReport.aggregate({
      where: {
        companyId,
        reportDate: { gte: periodStart, lte: periodEnd },
        // On ne peut pas filtrer par vehiclePlate ici car DailyFuelReport n'a pas vehicleId
      },
      _sum: { distanceKm: true },
    });

    const gpsKm = gpsDistance._sum.distanceKm || 0;
    if (gpsKm <= 0) return;

    const manualKm = fuelLog.kilometers;
    const ratio = manualKm / gpsKm;

    // Seuil de tolérance : si le kilométrage saisi est > 3x la distance GPS, c'est suspect
    const CROSS_CHECK_THRESHOLD = 3;
    if (ratio > CROSS_CHECK_THRESHOLD) {
      await this.prisma.fuelLog.update({
        where: { id: fuelLog.id },
        data: {
          anomalyFlag: true,
          anomalyReason: `Distance saisie (${manualKm}km) très supérieure à la distance GPS (${gpsKm.toFixed(1)}km) sur la période — rapport ×${ratio.toFixed(1)}`,
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
  }

  private async analyzeFuelLog(
    fuelLogId: string,
    companyId: string,
    licensePlate: string,
    calcConsumption: number | null,
    expectedConsumption: number | null,
    isAnomaly: boolean,
  ) {
    if (!isAnomaly) return;

    await this.notifications.create(companyId, {
      type: NotificationType.fuel_anomaly,
      priority: NotificationPriority.high,
      title: 'Fuel Consumption Anomaly',
      message: `Vehicle ${licensePlate} exceeded consumption threshold: ${calcConsumption?.toFixed(1)} L/100km (expected ${expectedConsumption?.toFixed(1)} L/100km)`,
      link: `/fuel-consumption`,
      deliveryId: undefined,
    });
  }
}
