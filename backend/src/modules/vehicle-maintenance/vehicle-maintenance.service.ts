import { Injectable, Logger, NotFoundException, BadRequestException, Optional, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { acquireCronLock } from '../../common/scheduling/cron-lock';
import { CreateMaintenanceScheduleDto } from './dto/create-maintenance-schedule.dto';
import { UpdateMaintenanceScheduleDto } from './dto/update-maintenance-schedule.dto';

// Seuil d'avertissement AVANT l'échéance réelle — l'admin a le temps de
// planifier plutôt que de découvrir un dépassement le jour même. Choix
// pragmatique (pas configurable en v1) : ~10% d'un intervalle vidange
// courant (5000km) et 2 semaines pour une échéance calendaire.
const WARNING_KM_THRESHOLD = 500;
const WARNING_DAYS_THRESHOLD = 14;

export type MaintenanceStatus = 'ok' | 'upcoming' | 'overdue';

export interface MaintenanceScheduleWithStatus {
  id: string;
  label: string;
  type: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  isActive: boolean;
  vehicleId: string;
  vehicleLabel: string;
  referenceDate: Date;
  kmSinceService: number | null;
  kmRemaining: number | null;
  nextDueDate: Date | null;
  daysRemaining: number | null;
  status: MaintenanceStatus;
}

@Injectable()
export class VehicleMaintenanceService {
  private readonly logger = new Logger(VehicleMaintenanceService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  private async assertVehicleInCompany(companyId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId, deletedAt: null },
      select: { id: true, brand: true, model: true, licensePlate: true },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async create(companyId: string, vehicleId: string, dto: CreateMaintenanceScheduleDto) {
    await this.assertVehicleInCompany(companyId, vehicleId);
    if (!dto.intervalKm && !dto.intervalMonths) {
      throw new BadRequestException(
        'Précisez un intervalle en kilomètres et/ou en mois (au moins un des deux)',
      );
    }

    return this.prisma.vehicleMaintenanceSchedule.create({
      data: {
        companyId,
        vehicleId,
        label: dto.label,
        type: dto.type,
        intervalKm: dto.intervalKm,
        intervalMonths: dto.intervalMonths,
      },
    });
  }

  async update(companyId: string, id: string, dto: UpdateMaintenanceScheduleDto) {
    const existing = await this.prisma.vehicleMaintenanceSchedule.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Maintenance schedule not found');

    const nextIntervalKm = dto.intervalKm !== undefined ? dto.intervalKm : existing.intervalKm;
    const nextIntervalMonths =
      dto.intervalMonths !== undefined ? dto.intervalMonths : existing.intervalMonths;
    if (!nextIntervalKm && !nextIntervalMonths) {
      throw new BadRequestException(
        'Précisez un intervalle en kilomètres et/ou en mois (au moins un des deux)',
      );
    }

    return this.prisma.vehicleMaintenanceSchedule.update({
      where: { id },
      data: {
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.intervalKm !== undefined && { intervalKm: dto.intervalKm }),
        ...(dto.intervalMonths !== undefined && { intervalMonths: dto.intervalMonths }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(companyId: string, id: string) {
    const existing = await this.prisma.vehicleMaintenanceSchedule.findFirst({
      where: { id, companyId },
    });
    if (!existing) throw new NotFoundException('Maintenance schedule not found');
    await this.prisma.vehicleMaintenanceSchedule.delete({ where: { id } });
    return { message: 'Maintenance schedule deleted' };
  }

  /**
   * Référence de départ du décompte pour une règle donnée : date du
   * MaintenanceRecord le plus récent du même vehicleId+type (l'entretien a
   * réellement été fait), ou date de création de la règle si aucun
   * MaintenanceRecord n'existe encore (on compte "à partir de maintenant",
   * plutôt que de bloquer la création d'une règle tant qu'aucun historique
   * n'a été saisi).
   */
  private async getReferenceDate(vehicleId: string, type: string, scheduleCreatedAt: Date) {
    const lastRecord = await this.prisma.maintenanceRecord.findFirst({
      where: { vehicleId, type },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return lastRecord?.date ?? scheduleCreatedAt;
  }

  /**
   * Kilométrage parcouru depuis `since` : somme de DailyFuelReport.distanceKm
   * (déjà calculé et testé pour le rapport carburant — voir
   * fuel-consumption.service.ts) — aucune nouvelle logique de distance GPS.
   */
  private async getKmSince(vehicleId: string, since: Date): Promise<number> {
    const result = await this.prisma.dailyFuelReport.aggregate({
      where: { vehicleId, reportDate: { gt: since } },
      _sum: { distanceKm: true },
    });
    return result._sum.distanceKm ?? 0;
  }

  private computeStatus(
    kmRemaining: number | null,
    daysRemaining: number | null,
  ): MaintenanceStatus {
    if ((kmRemaining !== null && kmRemaining <= 0) || (daysRemaining !== null && daysRemaining <= 0)) {
      return 'overdue';
    }
    if (
      (kmRemaining !== null && kmRemaining <= WARNING_KM_THRESHOLD) ||
      (daysRemaining !== null && daysRemaining <= WARNING_DAYS_THRESHOLD)
    ) {
      return 'upcoming';
    }
    return 'ok';
  }

  private async withStatus(
    schedule: {
      id: string;
      label: string;
      type: string;
      intervalKm: number | null;
      intervalMonths: number | null;
      isActive: boolean;
      vehicleId: string;
      createdAt: Date;
    },
    vehicleLabel: string,
  ): Promise<MaintenanceScheduleWithStatus> {
    const referenceDate = await this.getReferenceDate(
      schedule.vehicleId,
      schedule.type,
      schedule.createdAt,
    );
    const kmSinceService = schedule.intervalKm
      ? await this.getKmSince(schedule.vehicleId, referenceDate)
      : null;
    const kmRemaining =
      schedule.intervalKm && kmSinceService !== null
        ? Math.round((schedule.intervalKm - kmSinceService) * 10) / 10
        : null;

    let nextDueDate: Date | null = null;
    let daysRemaining: number | null = null;
    if (schedule.intervalMonths) {
      nextDueDate = new Date(referenceDate);
      nextDueDate.setMonth(nextDueDate.getMonth() + schedule.intervalMonths);
      daysRemaining = Math.ceil((nextDueDate.getTime() - Date.now()) / 86_400_000);
    }

    return {
      id: schedule.id,
      label: schedule.label,
      type: schedule.type,
      intervalKm: schedule.intervalKm,
      intervalMonths: schedule.intervalMonths,
      isActive: schedule.isActive,
      vehicleId: schedule.vehicleId,
      vehicleLabel,
      referenceDate,
      kmSinceService,
      kmRemaining,
      nextDueDate,
      daysRemaining,
      status: this.computeStatus(kmRemaining, daysRemaining),
    };
  }

  async findAllForVehicle(
    companyId: string,
    vehicleId: string,
  ): Promise<MaintenanceScheduleWithStatus[]> {
    const vehicle = await this.assertVehicleInCompany(companyId, vehicleId);
    const schedules = await this.prisma.vehicleMaintenanceSchedule.findMany({
      where: { companyId, vehicleId },
      orderBy: { createdAt: 'desc' },
    });
    const vehicleLabel = `${vehicle.brand} ${vehicle.model} (${vehicle.licensePlate})`;
    return Promise.all(schedules.map((s) => this.withStatus(s, vehicleLabel)));
  }

  /** Toutes les règles actives de l'entreprise dont le statut n'est PAS 'ok' — widget dashboard. */
  async findDueSoon(companyId: string): Promise<MaintenanceScheduleWithStatus[]> {
    const schedules = await this.prisma.vehicleMaintenanceSchedule.findMany({
      where: { companyId, isActive: true },
      include: { vehicle: { select: { brand: true, model: true, licensePlate: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const withStatuses = await Promise.all(
      schedules.map((s) =>
        this.withStatus(s, `${s.vehicle.brand} ${s.vehicle.model} (${s.vehicle.licensePlate})`),
      ),
    );
    return withStatuses
      .filter((s) => s.status !== 'ok')
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1));
  }

  /**
   * Cron quotidien (après la génération des rapports carburant, qui alimente
   * getKmSince) : crée une Notification type maintenance_due pour chaque
   * règle active devenue 'upcoming' ou 'overdue' — réutilise
   * NotificationsService.create tel quel (déjà affiché partout côté
   * frontend : cloche, page Alertes, préférences utilisateur "maintenanceDue").
   *
   * Anti-spam SANS Redis/nouveau champ : on ne recrée pas de notification pour
   * une règle qui a déjà une Notification maintenance_due NON RÉSOLUE en cours
   * (identifiée via `link`, qui encode le scheduleId) — l'admin "résout"
   * l'alerte une fois l'entretien planifié/fait, ce qui autorise une nouvelle
   * alerte au prochain cycle. Cohérent avec le pattern resolved existant
   * (AlertsService.resolve), pas un mécanisme de dédup ad hoc en plus.
   */
  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async checkDueMaintenances() {
    if (!(await acquireCronLock(this.redis, 'maintenance.checkDueMaintenances', 3600))) return;
    this.logger.log('Starting maintenance schedule check...');

    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let alertsCreated = 0;

    for (const company of companies) {
      try {
        const due = await this.findDueSoon(company.id);
        for (const item of due) {
          const link = `/vehicles?maintenanceScheduleId=${item.id}`;
          const existingAlert = await this.prisma.notification.findFirst({
            where: {
              companyId: company.id,
              type: NotificationType.maintenance_due,
              resolved: false,
              link,
            },
            select: { id: true },
          });
          if (existingAlert) continue;

          const parts: string[] = [];
          if (item.kmRemaining !== null) {
            parts.push(
              item.kmRemaining <= 0
                ? `dépassé de ${Math.abs(item.kmRemaining)} km`
                : `dans ${item.kmRemaining} km`,
            );
          }
          if (item.daysRemaining !== null) {
            parts.push(
              item.daysRemaining <= 0
                ? `dépassé de ${Math.abs(item.daysRemaining)} j`
                : `dans ${item.daysRemaining} j`,
            );
          }

          await this.notifications.create(company.id, {
            type: NotificationType.maintenance_due,
            priority: item.status === 'overdue' ? NotificationPriority.high : NotificationPriority.medium,
            title: `Entretien ${item.status === 'overdue' ? 'en retard' : 'à prévoir'} : ${item.label}`,
            message: `${item.vehicleLabel} — ${item.label} (${parts.join(', ')})`,
            link,
          });
          alertsCreated++;
        }
      } catch (err: any) {
        this.logger.error(`Failed maintenance check for company ${company.id}: ${err.message}`);
      }
    }

    this.logger.log(`Maintenance schedule check complete. ${alertsCreated} alert(s) created.`);
  }
}
