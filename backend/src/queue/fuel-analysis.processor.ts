import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { FuelConsumptionService } from '../modules/fuel-consumption/fuel-consumption.service';

interface FuelAnalysisJobData {
  fuelLogId: string;
  vehicleId: string;
  companyId: string;
}

interface RecomputeDriverReportJobData {
  companyId: string;
  driverId: string;
  date?: string;
  status?: string;
}

@Processor('fuel-analysis')
export class FuelAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(FuelAnalysisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private fuelConsumption: FuelConsumptionService,
  ) {
    super();
  }

  async process(job: Job<FuelAnalysisJobData | RecomputeDriverReportJobData>): Promise<void> {
    if (job.name === 'recompute-driver-report') {
      await this.processDriverReport(job as Job<RecomputeDriverReportJobData>);
      return;
    }

    if (job.name === 'analyze') {
      await this.processFuelLogAnalysis(job as Job<FuelAnalysisJobData>);
      return;
    }

    this.logger.warn(`Unknown job type on fuel-analysis queue: ${job.name}`);
  }

  /**
   * Recalcul temps réel du DailyFuelReport d'un seul chauffeur (déclenché à chaque
   * livraison marquée delivered). Cible UNIQUEMENT le chauffeur de la livraison,
   * jamais toute la company.
   */
  private async processDriverReport(job: Job<RecomputeDriverReportJobData>): Promise<void> {
    const { companyId, driverId, date, status } = job.data;

    try {
      await this.fuelConsumption.generateDailyReportForSingleDriver(
        companyId,
        driverId,
        date ? new Date(date) : undefined,
      );
      this.logger.log(
        `Driver fuel report recomputed for driver ${driverId} (company ${companyId})${status ? ` [delivery status: ${status}]` : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to recompute driver fuel report for ${driverId}: ${error}`,
      );
      throw error;
    }
  }

  private async processFuelLogAnalysis(job: Job<FuelAnalysisJobData>): Promise<void> {
    const { fuelLogId, companyId } = job.data;

    try {
      const [fuelLog, fuelSettings] = await Promise.all([
        this.prisma.fuelLog.findFirst({
          where: { id: fuelLogId, companyId },
          include: { vehicle: true },
        }),
        this.prisma.companyFuelSettings.findUnique({
          where: { companyId },
          select: { anomalyThreshold: true },
        }),
      ]);

      if (!fuelLog) {
        this.logger.warn(`FuelLog ${fuelLogId} not found`);
        return;
      }

      const calculatedConsumption =
        fuelLog.kilometers > 0 ? (fuelLog.liters / fuelLog.kilometers) * 100 : null;

      let anomalyFlag = false;
      let anomalyReason: string | null = null;
      const theoretical = fuelLog.vehicle.theoreticalConsumption;

      const defaultThreshold = parseInt(process.env.FUEL_ANOMALY_THRESHOLD_PERCENT || '20', 10);
      const threshold = fuelSettings?.anomalyThreshold ?? defaultThreshold;

      if (calculatedConsumption !== null) {
        if (theoretical && theoretical > 0) {
          const deviation = (Math.abs(calculatedConsumption - theoretical) / theoretical) * 100;

          if (deviation > threshold) {
            anomalyFlag = true;
            anomalyReason = `Consumption ${calculatedConsumption.toFixed(2)} L/100km deviates ${deviation.toFixed(1)}% from theoretical ${theoretical} L/100km (threshold: ${threshold}%)`;
          }
        }
      }

      await this.prisma.fuelLog.update({
        where: { id: fuelLogId },
        data: { calculatedConsumption, anomalyFlag, anomalyReason },
      });

      this.logger.log(
        `FuelLog ${fuelLogId}: consumption=${calculatedConsumption?.toFixed(2)} L/100km, anomaly=${anomalyFlag}`,
      );

      if (anomalyFlag && calculatedConsumption !== null) {
        await this.notifications.create(companyId, {
          type: NotificationType.fuel_anomaly,
          priority: NotificationPriority.high,
          title: 'Fuel Consumption Anomaly',
          message: `Vehicle ${fuelLog.vehicle.licensePlate} exceeded consumption threshold: ${calculatedConsumption.toFixed(1)} L/100km (expected ${theoretical?.toFixed(1) || 'N/A'} L/100km)`,
          link: `/fuel-consumption`,
          deliveryId: undefined,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to process fuel analysis for ${fuelLogId}: ${error}`);
      throw error;
    }
  }
}
