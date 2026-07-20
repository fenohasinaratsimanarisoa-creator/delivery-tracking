import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface FuelAnalysisJobData {
  fuelLogId: string;
  vehicleId: string;
  companyId: string;
}

export async function processFuelAnalysis(
  data: FuelAnalysisJobData,
  prisma: PrismaService,
  anomalyThresholdPercent: number,
): Promise<{ isAnomaly: boolean; calculatedConsumption: number | null; expectedConsumption: number | null } | void> {
  const logger = new Logger('FuelAnalysisJob');

  try {
    const fuelLog = await prisma.fuelLog.findUnique({
      where: { id: data.fuelLogId },
      include: { vehicle: true },
    });

    if (!fuelLog) {
      logger.warn(`FuelLog ${data.fuelLogId} not found`);
      return;
    }

    // Calculate consumption: L/100km = (liters / kilometers) * 100
    const calculatedConsumption =
      fuelLog.kilometers > 0
        ? (fuelLog.liters / fuelLog.kilometers) * 100
        : null;

    let anomalyFlag = false;
    let anomalyReason: string | null = null;
    const theoretical = fuelLog.vehicle.theoreticalConsumption;

    if (calculatedConsumption !== null) {
      if (theoretical && theoretical > 0) {
        const deviation =
          (Math.abs(calculatedConsumption - theoretical) / theoretical) * 100;

        if (deviation > anomalyThresholdPercent) {
          anomalyFlag = true;
          anomalyReason = `Consumption ${calculatedConsumption.toFixed(2)} L/100km deviates ${deviation.toFixed(1)}% from theoretical ${theoretical} L/100km (threshold: ${anomalyThresholdPercent}%)`;
        }
      }
    }
    await prisma.fuelLog.update({
      where: { id: data.fuelLogId },
      data: {
        calculatedConsumption,
        anomalyFlag,
        anomalyReason,
      },
    });

    logger.log(
      `FuelLog ${data.fuelLogId}: consumption=${calculatedConsumption?.toFixed(2)} L/100km, anomaly=${anomalyFlag}`,
    );

    return { isAnomaly: anomalyFlag, calculatedConsumption, expectedConsumption: theoretical };
  } catch (error) {
    logger.error(`Failed to process fuel analysis for ${data.fuelLogId}: ${error}`);
  }
}
