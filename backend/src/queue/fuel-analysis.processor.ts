import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';

interface FuelAnalysisJobData {
  fuelLogId: string;
  vehicleId: string;
  companyId: string;
}

@Processor('fuel-analysis')
export class FuelAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(FuelAnalysisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<FuelAnalysisJobData>): Promise<void> {
    const { fuelLogId, companyId } = job.data;
    const threshold = parseInt(process.env.FUEL_ANOMALY_THRESHOLD_PERCENT || '20', 10);

    try {
      const fuelLog = await this.prisma.fuelLog.findFirst({
        where: { id: fuelLogId, companyId },
        include: { vehicle: true },
      });

      if (!fuelLog) {
        this.logger.warn(`FuelLog ${fuelLogId} not found`);
        return;
      }

      const calculatedConsumption =
        fuelLog.kilometers > 0 ? (fuelLog.liters / fuelLog.kilometers) * 100 : null;

      let anomalyFlag = false;
      let anomalyReason: string | null = null;
      const theoretical = fuelLog.vehicle.theoreticalConsumption;

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
