import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { hasFuelAnomaly } from '../../common/fuel/fuel-anomaly.utils';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async getKpis(companyId: string) {
    const cacheKey = `dashboard:kpis:${companyId}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [deliveriesToday, totalDeliveries, activeVehicles, activeDrivers, fuelLogs, anomalies] =
      await Promise.all([
        this.prisma.delivery.count({
          where: { companyId, createdAt: { gte: today, lt: tomorrow } },
        }),
        this.prisma.delivery.count({ where: { companyId } }),
        this.prisma.vehicle.count({ where: { companyId, isActive: true } }),
        this.prisma.driver.count({ where: { companyId, isActive: true } }),
        this.prisma.fuelLog.findMany({
          where: { companyId },
          orderBy: { fillDate: 'desc' },
          take: 50,
        }),
        this.prisma.fuelLog.count({
          where: {
            companyId,
            OR: [{ consumptionAnomalyFlag: true }, { gpsAnomalyFlag: true }],
          },
        }),
      ]);

    const totalLiters = fuelLogs.reduce((s, l) => s + l.liters, 0);
    const totalKm = fuelLogs.reduce((s, l) => s + l.kilometers, 0);

    const result = {
      deliveriesToday,
      totalDeliveries,
      activeVehicles,
      activeDrivers,
      anomalies,
      fuelStats: {
        totalLiters,
        totalKilometers: totalKm,
        averageConsumption: totalKm > 0 ? (totalLiters / totalKm) * 100 : 0,
        recentLogs: fuelLogs.slice(0, 10),
      },
    };

    await this.cache.set(cacheKey, result, 60);
    return result;
  }

  async getDeliveryStats(companyId: string) {
    const cacheKey = `dashboard:deliveryStats:${companyId}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const statuses = [
      'pending',
      'assigned',
      'in_progress',
      'delivered',
      'failed',
      'cancelled',
    ] as const;
    const counts = await Promise.all(
      statuses.map((status) => this.prisma.delivery.count({ where: { companyId, status } })),
    );
    const result = statuses.map((status, i) => ({ status, count: counts[i] }));

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getReliabilityScore(companyId: string) {
    const cacheKey = `dashboard:reliability:${companyId}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    // Fenêtre sur createdAt (TOUJOURS positionné) et non completedAt : une livraison
    // `failed` a completedAt = null et était donc exclue du calcul → le score
    // « fiabilité » ne pénalisait JAMAIS les échecs (100/100 même en échec total).
    const [currentPeriod, previousPeriod] = await Promise.all([
      this.prisma.delivery.findMany({
        where: {
          companyId,
          status: { in: ['delivered', 'failed'] },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { status: true, completedAt: true, scheduledDate: true },
      }),
      this.prisma.delivery.findMany({
        where: {
          companyId,
          status: { in: ['delivered', 'failed'] },
          createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
        },
        select: { status: true, completedAt: true, scheduledDate: true },
      }),
    ]);

    const calculateScore = (
      deliveries: Array<{ status: string; completedAt: Date | null; scheduledDate: Date | null }>,
    ) => {
      const total = deliveries.length;
      if (total === 0) return { score: 100, onTime: 0, total: 0 };
      // Fiabilité = livraisons livrées À TEMPS / toutes les livraisons terminées
      // (delivered + failed). Les échecs comptent donc contre le score, et une
      // livraison failed n'est jamais « on time ».
      const onTime = deliveries.filter((d) => {
        if (d.status !== 'delivered') return false;
        if (!d.scheduledDate) return true;
        return d.completedAt && d.completedAt <= d.scheduledDate;
      });
      return {
        score: Math.round((onTime.length / total) * 100),
        onTime: onTime.length,
        total,
      };
    };

    const current = calculateScore(currentPeriod);
    const previous = calculateScore(previousPeriod);

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (current.total > 0 && previous.total > 0) {
      if (current.score > previous.score) trend = 'up';
      else if (current.score < previous.score) trend = 'down';
    }

    const result = { score: current.score, trend, onTime: current.onTime, total: current.total };
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  async getFuelStatsForChart(companyId: string) {
    const cacheKey = `dashboard:fuelChart:${companyId}`;
    const cached = await this.cache.get<any[]>(cacheKey);
    if (cached) return cached;

    const logs = await this.prisma.fuelLog.findMany({
      where: { companyId },
      orderBy: { fillDate: 'asc' },
      select: {
        id: true,
        fillDate: true,
        liters: true,
        kilometers: true,
        consumptionAnomalyFlag: true,
        gpsAnomalyFlag: true,
        vehicle: { select: { licensePlate: true } },
      },
    });

    const result = logs.map((l) => ({
      date: l.fillDate.toISOString().split('T')[0],
      liters: l.liters,
      kilometers: l.kilometers,
      consumption: l.kilometers > 0 ? (l.liters / l.kilometers) * 100 : 0,
      vehicle: l.vehicle.licensePlate,
      anomaly: hasFuelAnomaly(l),
    }));

    await this.cache.set(cacheKey, result, 300);
    return result;
  }
}
