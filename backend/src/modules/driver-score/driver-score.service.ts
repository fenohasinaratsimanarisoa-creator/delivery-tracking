import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { acquireCronLock } from '../../common/scheduling/cron-lock';

// Formule validée avec l'utilisateur (mvpromax.md §1.3) : base 100, pénalité par
// évènement plafonnée, ramenée à un pas de 100km parcourus pour qu'un chauffeur
// qui roule plus ne soit pas mécaniquement pénalisé.
const SPEEDING_PENALTY_PER_EVENT = 2;
const SPEEDING_PENALTY_CAP = 30;
const HARSH_PENALTY_PER_EVENT = 1;
const HARSH_PENALTY_CAP = 30;
// Freinage/accélération brusque : écart de vitesse ≥ 8 km/h en ≤ 1s entre deux
// positions GPS consécutives, sur un intervalle ≤ 5s (au-delà, un trou GPS rend
// le delta de vitesse non significatif — faux positif).
const HARSH_ACCEL_THRESHOLD_KMH_PER_S = 8;
const HARSH_EVENT_MAX_GAP_S = 5;
const NORMALIZATION_STEP_KM = 100;
// En-dessous de ce seuil, extrapoler à 100km amplifierait démesurément un
// évènement isolé sur un trajet très court — on garde alors le compte brut.
const MIN_DISTANCE_FOR_NORMALIZATION_KM = 20;
// Garde-fou volume, même valeur que MAX_POSITIONS_PER_DAILY_REPORT dans
// fuel-consumption.service.ts (une journée normale reste très en dessous).
const MAX_POSITIONS_PER_SCORE = 60_000;

export interface DriverScoreSummary {
  avgScore: number;
  daysScored: number;
  distanceKm: number;
  speedingEvents: number;
  harshEvents: number;
}

@Injectable()
export class DriverScoreService {
  private readonly logger = new Logger(DriverScoreService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {}

  private getMadagascarDayBounds(date: Date): { start: Date; end: Date } {
    const start = new Date(date);
    start.setUTCHours(21, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 1);

    const end = new Date(date);
    end.setUTCHours(20, 59, 59, 999);
    end.setUTCDate(end.getUTCDate());

    return { start, end };
  }

  private computeEvents(
    positions: Array<{ speed: number | null; timestamp: Date }>,
    speedThresholdKmh: number | null,
  ): { speedingEvents: number; harshEvents: number } {
    let speedingEvents = 0;
    if (speedThresholdKmh) {
      for (const p of positions) {
        if (p.speed == null) continue;
        if (p.speed * 3.6 > speedThresholdKmh) speedingEvents++;
      }
    }

    let harshEvents = 0;
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const cur = positions[i];
      if (prev.speed == null || cur.speed == null) continue;
      const dtS = (cur.timestamp.getTime() - prev.timestamp.getTime()) / 1000;
      if (dtS <= 0 || dtS > HARSH_EVENT_MAX_GAP_S) continue;
      const deltaKmh = Math.abs(cur.speed - prev.speed) * 3.6;
      if (deltaKmh / dtS >= HARSH_ACCEL_THRESHOLD_KMH_PER_S) harshEvents++;
    }

    return { speedingEvents, harshEvents };
  }

  private computePenalty(events: number, distanceKm: number, perEvent: number, cap: number): number {
    if (events === 0) return 0;
    const normalizedEvents =
      distanceKm >= MIN_DISTANCE_FOR_NORMALIZATION_KM
        ? events / (distanceKm / NORMALIZATION_STEP_KM)
        : events;
    return Math.min(cap, normalizedEvents * perEvent);
  }

  computeScore(speedingEvents: number, harshEvents: number, distanceKm: number): number {
    const speedingPenalty = this.computePenalty(
      speedingEvents,
      distanceKm,
      SPEEDING_PENALTY_PER_EVENT,
      SPEEDING_PENALTY_CAP,
    );
    const harshPenalty = this.computePenalty(
      harshEvents,
      distanceKm,
      HARSH_PENALTY_PER_EVENT,
      HARSH_PENALTY_CAP,
    );
    return Math.max(0, Math.round(100 - speedingPenalty - harshPenalty));
  }

  /**
   * Cron nocturne (23h30, après le cron carburant 22h et le cron maintenance
   * 23h) : réutilise le regroupement (driverId, vehicleId, jour) déjà résolu
   * par DailyFuelReport — attribution driver/véhicule (positions sans
   * driverId, véhicules désassignés...) déjà traitée par
   * fuel-consumption.service.ts, pas de duplication de cette logique ici.
   */
  @Cron('30 23 * * *')
  async generateDailyScores() {
    if (!(await acquireCronLock(this.redis, 'driverScore.generateDailyScores', 3600))) return;
    this.logger.log('Starting driver score computation...');

    const rawDate = new Date();
    const targetDate = new Date(
      Date.UTC(rawDate.getUTCFullYear(), rawDate.getUTCMonth(), rawDate.getUTCDate()),
    );
    const bounds = this.getMadagascarDayBounds(rawDate);

    const companies = await this.prisma.company.findMany({ select: { id: true } });
    let scoresUpserted = 0;

    for (const company of companies) {
      try {
        const dayReports = await this.prisma.dailyFuelReport.findMany({
          where: { companyId: company.id, reportDate: targetDate },
          select: { driverId: true, vehicleId: true, distanceKm: true },
        });
        if (dayReports.length === 0) continue;

        const settings = await this.prisma.companySettings.findUnique({
          where: { companyId: company.id },
          select: { speedAlertThreshold: true },
        });

        for (const report of dayReports) {
          if (report.distanceKm <= 0) continue;

          const positions = await this.prisma.gpsPosition.findMany({
            where: {
              vehicleId: report.vehicleId,
              companyId: company.id,
              suspect: false,
              timestamp: { gte: bounds.start, lte: bounds.end },
            },
            orderBy: { timestamp: 'asc' },
            take: MAX_POSITIONS_PER_SCORE,
            select: { speed: true, timestamp: true },
          });

          const { speedingEvents, harshEvents } = this.computeEvents(
            positions,
            settings?.speedAlertThreshold ?? null,
          );
          const score = this.computeScore(speedingEvents, harshEvents, report.distanceKm);

          await this.prisma.driverScore.upsert({
            where: {
              driverId_vehicleId_scoreDate: {
                driverId: report.driverId,
                vehicleId: report.vehicleId,
                scoreDate: targetDate,
              },
            },
            create: {
              companyId: company.id,
              driverId: report.driverId,
              vehicleId: report.vehicleId,
              scoreDate: targetDate,
              score,
              speedingEvents,
              harshEvents,
              distanceKm: report.distanceKm,
            },
            update: { score, speedingEvents, harshEvents, distanceKm: report.distanceKm },
          });
          scoresUpserted++;
        }
      } catch (err: any) {
        this.logger.error(`Failed driver score computation for company ${company.id}: ${err.message}`);
      }
    }

    this.logger.log(`Driver score computation complete. ${scoresUpserted} score(s) upserted.`);
  }

  async getScoreSummary(
    companyId: string,
    from: Date,
    to: Date,
  ): Promise<Map<string, DriverScoreSummary>> {
    const rows = await this.prisma.driverScore.findMany({
      where: { companyId, scoreDate: { gte: from, lte: to } },
      select: {
        driverId: true,
        score: true,
        distanceKm: true,
        speedingEvents: true,
        harshEvents: true,
      },
    });

    const agg = new Map<
      string,
      { total: number; count: number; distanceKm: number; speedingEvents: number; harshEvents: number }
    >();
    for (const row of rows) {
      const entry = agg.get(row.driverId) ?? {
        total: 0,
        count: 0,
        distanceKm: 0,
        speedingEvents: 0,
        harshEvents: 0,
      };
      entry.total += row.score;
      entry.count += 1;
      entry.distanceKm += row.distanceKm;
      entry.speedingEvents += row.speedingEvents;
      entry.harshEvents += row.harshEvents;
      agg.set(row.driverId, entry);
    }

    const result = new Map<string, DriverScoreSummary>();
    for (const [driverId, entry] of agg) {
      result.set(driverId, {
        avgScore: Math.round(entry.total / entry.count),
        daysScored: entry.count,
        distanceKm: Math.round(entry.distanceKm * 10) / 10,
        speedingEvents: entry.speedingEvents,
        harshEvents: entry.harshEvents,
      });
    }
    return result;
  }
}
