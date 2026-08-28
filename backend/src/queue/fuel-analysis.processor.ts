import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  NotificationType,
  NotificationPriority,
  ConsumptionDeviationDirection,
} from '@prisma/client';
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

    // Cross-check GPS déporté hors du chemin HTTP (audit 2026-08-28, C2) : ce
    // travail scanne toute la trace du véhicule entre deux pleins (jusqu'à
    // plusieurs centaines de milliers de positions, lues par pages bornées).
    if (job.name === 'cross-check-gps') {
      const { fuelLogId, companyId } = (job as Job<FuelAnalysisJobData>).data;
      try {
        await this.fuelConsumption.runGpsCrossCheckForLog(fuelLogId, companyId);
      } catch (err) {
        // Une erreur ici ne doit pas faire échouer indéfiniment le job : le
        // cross-check est un contrôle a posteriori, il sera relancé à la
        // prochaine modification du plein.
        this.logger.error(
          `Cross-check GPS échoué pour le plein ${fuelLogId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
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
      this.logger.error(`Failed to recompute driver fuel report for ${driverId}: ${error}`);
      throw error;
    }
  }

  private async processFuelLogAnalysis(job: Job<FuelAnalysisJobData>): Promise<void> {
    const { fuelLogId, companyId } = job.data;

    try {
      const [fuelLog, fuelSettings] = await Promise.all([
        this.prisma.fuelLog.findFirst({
          where: { id: fuelLogId, companyId },
          include: {
            vehicle: {
              include: { driver: { select: { userId: true } } },
            },
          },
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

      let consumptionAnomalyFlag = false;
      let consumptionAnomalyReason: string | null = null;
      let consumptionDeviationDirection: ConsumptionDeviationDirection | null = null;
      let deviation: number | null = null;
      const theoretical = fuelLog.vehicle.theoreticalConsumption;

      // B9 : défaut ALIGNÉ sur le schéma (companyFuelSettings.anomalyThreshold @default(15)).
      // Avant : 20 en dur jusqu'à création de la ligne settings, puis 15 une fois créée →
      // le MÊME plein pouvait être analysé à 20% puis à 15% (verdicts changeants, fausses
      // alertes). L'env FUEL_ANOMALY_THRESHOLD_PERCENT reste la source de remplacement.
      const defaultThreshold = parseInt(process.env.FUEL_ANOMALY_THRESHOLD_PERCENT || '15', 10);
      const threshold = fuelSettings?.anomalyThreshold ?? defaultThreshold;

      if (calculatedConsumption !== null) {
        // B7 : référence de consommation = théorique du véhicule, sinon défaut 8 L/100km
        // (MÊME défaut que le DailyFuelReport, service ~ligne 1106). Avant, un véhicule
        // sans theoreticalConsumption n'était JAMAIS flaggé — même à 50 L/100km.
        const reference = theoretical && theoretical > 0 ? theoretical : 8;
        deviation = (Math.abs(calculatedConsumption - reference) / reference) * 100;

        if (deviation > threshold) {
          consumptionAnomalyFlag = true;
          consumptionAnomalyReason = `Consumption ${calculatedConsumption.toFixed(2)} L/100km deviates ${deviation.toFixed(1)}% from expected ${reference} L/100km (threshold: ${threshold}%)`;
          // Sens réel de l'écart : la détection est bidirectionnelle (Math.abs), une
          // sous-consommation (mesuré < théorique) n'est PAS un dépassement. Le champ
          // permet au frontend d'afficher over/under sans parser le message.
          consumptionDeviationDirection =
            calculatedConsumption > reference
              ? ConsumptionDeviationDirection.over
              : ConsumptionDeviationDirection.under;
        }
      }

      // Ce détecteur n'écrit QUE sa propre paire de champs (consumptionAnomalyFlag/
      // consumptionAnomalyReason) + la direction associée. Il ne touche jamais aux champs
      // GPS ni au champ dérivé anomalyFlag (calculé en lecture) : sinon il écraserait la
      // détection GPS concurrente (write-loss).
      await this.prisma.fuelLog.update({
        where: { id: fuelLogId },
        data: {
          calculatedConsumption,
          consumptionAnomalyFlag,
          consumptionAnomalyReason,
          consumptionDeviationDirection,
        },
      });

      this.logger.log(
        `FuelLog ${fuelLogId}: consumption=${calculatedConsumption?.toFixed(2)} L/100km, anomaly=${consumptionAnomalyFlag}${consumptionDeviationDirection ? ` (${consumptionDeviationDirection})` : ''}`,
      );

      if (consumptionAnomalyFlag && calculatedConsumption !== null && deviation !== null) {
        // Message honnête reflétant le sens réel de l'écart : 'above' (sur-consommation)
        // ou 'below' (sous-consommation). L'ancien libellé « exceeded consumption
        // threshold » était FAUX en sous-consommation (conso mesurée < théorique), ce qui
        // induisait l'utilisateur en erreur sur la situation opérationnelle (une
        // sous-consommation évoque un km manuel surdéclaré / mauvais théorique / erreur de
        // saisie, PAS une fuite ou un vol de carburant).
        const direction =
          consumptionDeviationDirection === ConsumptionDeviationDirection.over ? 'above' : 'below';
        await this.notifications.create(companyId, {
          type: NotificationType.fuel_anomaly,
          priority: NotificationPriority.high,
          title: 'Fuel Consumption Anomaly',
          message: `Vehicle ${fuelLog.vehicle.licensePlate}: consumption ${calculatedConsumption.toFixed(1)} L/100km is ${deviation.toFixed(0)}% ${direction} the expected ${(theoretical && theoretical > 0 ? theoretical : 8).toFixed(1)} L/100km`,
          link: `/fuel-consumption`,
          deliveryId: undefined,
          userId: fuelLog.vehicle?.driver?.userId ?? undefined,
        });
      }
    } catch (error) {
      this.logger.error(`Failed to process fuel analysis for ${fuelLogId}: ${error}`);
      throw error;
    }
  }
}
