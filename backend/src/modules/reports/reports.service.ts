import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  async getDeliveryReport(companyId: string, from?: string, to?: string) {
    const periodStart = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const periodEnd = to ? new Date(to + 'T23:59:59.999Z') : new Date();

    const cacheKey = `reports:delivery:${companyId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const where = { companyId, createdAt: { gte: periodStart, lte: periodEnd } };

    const [total, statusBreakdown, completed, onTime] = await Promise.all([
      this.prisma.delivery.count({ where }),
      Promise.all(
        (['pending', 'assigned', 'in_progress', 'delivered', 'failed', 'cancelled'] as const).map(
          (status) =>
            this.prisma.delivery.count({ where: { ...where, status } }).then((count) => ({ status, count })),
        ),
      ),
      this.prisma.delivery.findMany({
        where: { ...where, status: 'delivered', completedAt: { not: null } },
        select: { completedAt: true, scheduledDate: true, createdAt: true },
      }),
      this.prisma.delivery.count({
        where: {
          ...where,
          status: 'delivered',
          completedAt: { not: null },
          scheduledDate: { not: null },
        },
      }),
    ]);

    const onTimeCount = completed.filter((d) => {
      if (!d.scheduledDate) return true;
      return d.completedAt && d.completedAt <= d.scheduledDate;
    }).length;

    const byDay = await this.getDeliveryCountByPeriod(companyId, periodStart, periodEnd, 'day');
    const byWeek = await this.getDeliveryCountByPeriod(companyId, periodStart, periodEnd, 'week');
    const byMonth = await this.getDeliveryCountByPeriod(companyId, periodStart, periodEnd, 'month');

    const result = {
      total,
      statusBreakdown,
      onTimeRate: completed.length > 0 ? Math.round((onTimeCount / completed.length) * 100) : 0,
      onTimeCount,
      completedCount: completed.length,
      byDay,
      byWeek,
      byMonth,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getFleetReport(companyId: string, from?: string, to?: string) {
    const periodStart = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const periodEnd = to ? new Date(to + 'T23:59:59.999Z') : new Date();

    const cacheKey = `reports:fleet:${companyId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const vehicles = await this.prisma.vehicle.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, brand: true, model: true, licensePlate: true, isActive: true,
        deliveries: {
          where: { createdAt: { gte: periodStart, lte: periodEnd } },
          select: { id: true },
        },
        gpsPositions: {
          where: { timestamp: { gte: periodStart, lte: periodEnd } },
          select: { latitude: true, longitude: true, timestamp: true, speed: true },
          orderBy: { timestamp: 'desc' },
          take: 2,
        },
      },
    });

    const fuelLogs = await this.prisma.fuelLog.findMany({
      where: { companyId, fillDate: { gte: periodStart, lte: periodEnd } },
      select: { liters: true, kilometers: true, vehicleId: true, anomalyFlag: true },
    });

    const vehicleData = vehicles.map((v) => {
      const vFuel = fuelLogs.filter((f) => f.vehicleId === v.id);
      const totalLiters = vFuel.reduce((s, f) => s + f.liters, 0);
      const totalKm = vFuel.reduce((s, f) => s + f.kilometers, 0);
      const positionCount = v.gpsPositions.length;
      const hasRecentPosition = positionCount > 0 && v.gpsPositions[0].timestamp > new Date(Date.now() - 3600000);

      return {
        vehicleId: v.id,
        vehicleName: `${v.brand} ${v.model}`,
        licensePlate: v.licensePlate,
        isActive: v.isActive,
        deliveriesCount: v.deliveries.length,
        fuelLiters: Math.round(totalLiters * 100) / 100,
        distanceKm: Math.round(totalKm * 100) / 100,
        avgConsumption: totalKm > 0 ? Math.round((totalLiters / totalKm) * 10000) / 100 : 0,
        anomalyCount: vFuel.filter((f) => f.anomalyFlag).length,
        isOnline: hasRecentPosition,
      };
    });

    const totalDistance = vehicleData.reduce((s, v) => s + v.distanceKm, 0);
    const totalFuel = vehicleData.reduce((s, v) => s + v.fuelLiters, 0);

    const result = {
      vehicles: vehicleData,
      totalDistance: Math.round(totalDistance * 100) / 100,
      totalFuel: Math.round(totalFuel * 100) / 100,
      activeCount: vehicles.filter((v) => v.isActive).length,
      onlineCount: vehicleData.filter((v) => v.isOnline).length,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async getDriverReport(companyId: string, from?: string, to?: string) {
    const periodStart = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    const periodEnd = to ? new Date(to + 'T23:59:59.999Z') : new Date();

    const cacheKey = `reports:driver:${companyId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
    const cached = await this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const drivers = await this.prisma.driver.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, phone: true, isActive: true,
        deliveries: {
          where: { createdAt: { gte: periodStart, lte: periodEnd } },
          select: { id: true, status: true, completedAt: true, scheduledDate: true },
        },
      },
    });

    const driverData = drivers.map((d) => {
      const completed = d.deliveries.filter((del) => del.status === 'delivered');
      const onTime = completed.filter((del) => {
        if (!del.scheduledDate) return true;
        return del.completedAt && del.completedAt <= del.scheduledDate;
      });

      return {
        driverId: d.id,
        driverName: `${d.firstName} ${d.lastName}`,
        phone: d.phone,
        isActive: d.isActive,
        totalDeliveries: d.deliveries.length,
        completedDeliveries: completed.length,
        onTimeDeliveries: onTime.length,
        onTimeRate: completed.length > 0 ? Math.round((onTime.length / completed.length) * 100) : 0,
        failedDeliveries: d.deliveries.filter((del) => del.status === 'failed').length,
        inProgressDeliveries: d.deliveries.filter((del) => del.status === 'in_progress').length,
      };
    });

    const result = {
      drivers: driverData,
      totalDeliveries: driverData.reduce((s, d) => s + d.totalDeliveries, 0),
      totalCompleted: driverData.reduce((s, d) => s + d.completedDeliveries, 0),
      overallOnTimeRate:
        driverData.reduce((s, d) => s + d.completedDeliveries, 0) > 0
          ? Math.round(
              (driverData.reduce((s, d) => s + d.onTimeDeliveries, 0) /
                driverData.reduce((s, d) => s + d.completedDeliveries, 0)) *
                100,
            )
          : 0,
    };

    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  private async getDeliveryCountByPeriod(
    companyId: string,
    from: Date,
    to: Date,
    groupBy: 'day' | 'week' | 'month',
  ): Promise<{ label: string; count: number }[]> {
    const deliveries = await this.prisma.delivery.findMany({
      where: { companyId, createdAt: { gte: from, lte: to } },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const buckets = new Map<string, number>();
    for (const d of deliveries) {
      let label: string;
      if (groupBy === 'day') {
        label = d.createdAt.toISOString().split('T')[0];
      } else if (groupBy === 'week') {
        const start = new Date(d.createdAt);
        start.setDate(start.getDate() - start.getDay());
        label = start.toISOString().split('T')[0];
      } else {
        label = `${d.createdAt.getFullYear()}-${String(d.createdAt.getMonth() + 1).padStart(2, '0')}`;
      }
      buckets.set(label, (buckets.get(label) || 0) + 1);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, count]) => ({ label, count }));
  }

  async exportPdf(reportType: string, companyId: string, from?: string, to?: string): Promise<Buffer> {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]);
    const { height } = page.getSize();
    let y = height - 50;

    const draw = (text: string, size = 10, bold = false) => {
      page.drawText(text, { x: 50, y, size, font: bold ? fontBold : font, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    };

    page.drawText('DeliveryTrack - Rapport', { x: 50, y, size: 18, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
    y -= 30;
    draw(`Type: ${reportType}`, 11);
    draw(`Période: ${from || 'Début'} → ${to || 'Aujourd\'hui'}`, 10);
    y -= 10;

    if (reportType === 'delivery' || reportType === 'all') {
      const delivery = await this.getDeliveryReport(companyId, from, to);
      draw('Rapport Livraisons', 14, true);
      y -= 4;
      draw(`Total : ${delivery.total}`);
      draw(`Taux à l'heure : ${delivery.onTimeRate}%`);
      draw(`Livrées : ${delivery.completedCount}`);
      draw(`À l'heure : ${delivery.onTimeCount}`);
      for (const s of delivery.statusBreakdown) {
        draw(`  ${s.status} : ${s.count}`);
      }
      y -= 10;
    }

    if (reportType === 'fleet' || reportType === 'all') {
      const fleet = await this.getFleetReport(companyId, from, to);
      draw('Rapport Flotte', 14, true);
      y -= 4;
      draw(`Distance totale : ${fleet.totalDistance} km`);
      draw(`Carburant total : ${fleet.totalFuel} L`);
      draw(`Véhicules actifs : ${fleet.activeCount}`);
      for (const v of fleet.vehicles) {
        draw(`${v.vehicleName} (${v.licensePlate}) : ${v.deliveriesCount} livraisons, ${v.distanceKm} km, ${v.avgConsumption} L/100km`);
      }
      y -= 10;
    }

    if (reportType === 'driver' || reportType === 'all') {
      const driver = await this.getDriverReport(companyId, from, to);
      draw('Rapport Chauffeurs', 14, true);
      y -= 4;
      draw(`Total livraisons : ${driver.totalDeliveries}`);
      draw(`Taux ponctualité global : ${driver.overallOnTimeRate}%`);
      for (const d of driver.drivers) {
        draw(`${d.driverName} : ${d.totalDeliveries} livraisons, ${d.onTimeRate}% ponctualité`);
      }
    }

    const buf = await doc.save();
    return Buffer.from(buf);
  }

  async exportExcel(reportType: string, companyId: string, from?: string, to?: string): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();

    if (reportType === 'delivery' || reportType === 'all') {
      const delivery = await this.getDeliveryReport(companyId, from, to);
      const ws = workbook.addWorksheet('Livraisons');
      ws.columns = [
        { header: 'Statut', key: 'statut', width: 20 },
        { header: 'Nombre', key: 'count', width: 12 },
      ];
      ws.addRows(delivery.statusBreakdown);
      ws.addRow({});
      ws.addRow({ statut: 'Total', count: delivery.total });
      ws.addRow({ statut: 'Taux à l\'heure', count: `${delivery.onTimeRate}%` });
    }

    if (reportType === 'fleet' || reportType === 'all') {
      const fleet = await this.getFleetReport(companyId, from, to);
      const ws = workbook.addWorksheet('Flotte');
      ws.columns = [
        { header: 'Véhicule', key: 'vehicle', width: 25 },
        { header: 'Immatriculation', key: 'plate', width: 18 },
        { header: 'Livraisons', key: 'deliveries', width: 12 },
        { header: 'Distance (km)', key: 'distance', width: 14 },
        { header: 'Carburant (L)', key: 'fuel', width: 14 },
        { header: 'Consommation (L/100km)', key: 'consumption', width: 20 },
        { header: 'Actif', key: 'active', width: 8 },
      ];
      for (const v of fleet.vehicles) {
        ws.addRow({
          vehicle: v.vehicleName,
          plate: v.licensePlate,
          deliveries: v.deliveriesCount,
          distance: v.distanceKm,
          fuel: v.fuelLiters,
          consumption: v.avgConsumption,
          active: v.isActive ? 'Oui' : 'Non',
        });
      }
    }

    if (reportType === 'driver' || reportType === 'all') {
      const driver = await this.getDriverReport(companyId, from, to);
      const ws = workbook.addWorksheet('Chauffeurs');
      ws.columns = [
        { header: 'Chauffeur', key: 'name', width: 25 },
        { header: 'Téléphone', key: 'phone', width: 15 },
        { header: 'Livraisons', key: 'total', width: 12 },
        { header: 'Complétées', key: 'completed', width: 12 },
        { header: 'À l\'heure', key: 'onTime', width: 12 },
        { header: 'Ponctualité', key: 'rate', width: 12 },
        { header: 'Échouées', key: 'failed', width: 10 },
      ];
      for (const d of driver.drivers) {
        ws.addRow({
          name: d.driverName,
          phone: d.phone || '-',
          total: d.totalDeliveries,
          completed: d.completedDeliveries,
          onTime: d.onTimeDeliveries,
          rate: `${d.onTimeRate}%`,
          failed: d.failedDeliveries,
        });
      }
    }

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf as ArrayBuffer);
  }
}
