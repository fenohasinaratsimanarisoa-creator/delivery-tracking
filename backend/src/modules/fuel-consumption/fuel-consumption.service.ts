import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFuelLogDto } from './dto/create-fuel-log.dto';
import { FuelFilterDto } from './dto/fuel-filter.dto';

@Injectable()
export class FuelConsumptionService {
  private readonly logger = new Logger(FuelConsumptionService.name);
  private readonly anomalyThresholdPercent: number;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    this.anomalyThresholdPercent = this.configService.get<number>(
      'FUEL_ANOMALY_THRESHOLD_PERCENT',
      20,
    );
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

    // Run analysis synchronously (no Redis needed)
    await this.analyzeFuelLog(fuelLog.id, companyId);

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
        include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
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
    if (!log) throw new Error('Fuel log not found');
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

  private async analyzeFuelLog(fuelLogId: string, companyId: string) {
    const { processFuelAnalysis } = await import('./jobs/fuel-analysis.job');
    await processFuelAnalysis(
      { fuelLogId, vehicleId: '', companyId },
      this.prisma,
      this.anomalyThresholdPercent,
    );
  }
}
