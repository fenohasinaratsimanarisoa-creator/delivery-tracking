import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async getKpis(companyId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [
      deliveriesToday,
      totalDeliveries,
      activeVehicles,
      activeDrivers,
      fuelLogs,
      anomalies,
    ] = await Promise.all([
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
      this.prisma.fuelLog.count({ where: { companyId, anomalyFlag: true } }),
    ]);

    const totalLiters = fuelLogs.reduce((s, l) => s + l.liters, 0);
    const totalKm = fuelLogs.reduce((s, l) => s + l.kilometers, 0);

    return {
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
  }

  async getDeliveryStats(companyId: string) {
    const statuses = ['pending', 'assigned', 'in_progress', 'delivered', 'failed', 'cancelled'] as const;
    const counts = await Promise.all(
      statuses.map((status) =>
        this.prisma.delivery.count({ where: { companyId, status } }),
      ),
    );
    return statuses.map((status, i) => ({ status, count: counts[i] }));
  }

  async getFuelStatsForChart(companyId: string) {
    const logs = await this.prisma.fuelLog.findMany({
      where: { companyId },
      orderBy: { fillDate: 'asc' },
      include: { vehicle: { select: { id: true, licensePlate: true } } },
    });

    return logs.map((l) => ({
      date: l.fillDate.toISOString().split('T')[0],
      liters: l.liters,
      kilometers: l.kilometers,
      consumption: l.kilometers > 0 ? (l.liters / l.kilometers) * 100 : 0,
      vehicle: l.vehicle.licensePlate,
      anomaly: l.anomalyFlag,
    }));
  }
}
