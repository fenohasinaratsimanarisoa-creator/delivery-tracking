import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { computeFilteredDistance } from '../../common/geo/geo.utils';
import { evaluateTeleportation, type TeleportReference } from '../../common/geo/teleportation.utils';
import { FuelConsumptionService } from './fuel-consumption.service';

// =============================================================================
// Verrou de non-régression : crossCheckFuelLogWithGps() / computeGpsCoverageFraction()
// (fuel-consumption.service.ts), qui s'appuient sur computeFilteredDistance()
// (common/geo/geo.utils.ts) et sur la détection de téléportation partagée
// (common/geo/teleportation.utils.ts). Cette logique est correcte mais n'avait
// AUCUNE suite de tests sur des traces GPS synthétiques réalistes — un futur
// refactor (ex. le calcul de coverage ou le clamp d'accuracy) pourrait la casser
// silencieusement sans qu'aucun test n'échoue. Chaque scénario ci-dessous
// construit une trace GPS en JS (pas de DB réelle) et exerce directement les
// méthodes du service via des mocks Prisma.
// =============================================================================

// ── Miroir des constantes PRIVÉES de fuel-consumption.service.ts (non exportées) ──
// Valeurs lues DIRECTEMENT dans le fichier source (lignes indiquées), jamais
// réinventées. Si elles changent là-bas, ce fichier doit être mis à jour en
// conséquence — c'est précisément le rôle d'un verrou de non-régression.
const FUEL_COVERAGE_MIN_FRACTION = 0.4; // fuel-consumption.service.ts:46
// const FUEL_COVERAGE_GAP_TOLERANCE_S = 300; // fuel-consumption.service.ts:50 (implicite dans les scénarios de gap ci-dessous)
const FUEL_COVERAGE_MIN_MANUAL_KM = 5; // fuel-consumption.service.ts:54

const EARTH_RADIUS_M = 6371000; // même valeur R que haversineDistance() (geo.utils.ts)
const BASE_LAT = -18.8792; // Antananarivo
const BASE_LNG = 47.5079;

/**
 * Décale une latitude de `distanceM` mètres plein nord. Un déplacement PUR nord
 * (longitude inchangée) est un grand cercle exact : la distance haversine
 * résultante entre deux points ainsi construits est connue analytiquement
 * (= distanceM), ce qui donne une distance de référence exacte pour ces tests,
 * sans dépendre d'une approximation.
 */
function latAfterNorthMove(startLat: number, distanceM: number): number {
  return startLat + (distanceM / EARTH_RADIUS_M) * (180 / Math.PI);
}

interface SyntheticPosition {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  timestamp: Date;
}

/** Trace rectiligne, fixes équirépartis dans le temps, vitesse cohérente avec l'écart. */
function buildCleanTrace(opts: {
  startTime: Date;
  intervalSec: number;
  fixCount: number;
  totalDistanceM: number;
  accuracy: number;
}): SyntheticPosition[] {
  const segCount = opts.fixCount - 1;
  const perSegmentM = opts.totalDistanceM / segCount;
  const speedMs = perSegmentM / opts.intervalSec;
  const positions: SyntheticPosition[] = [];
  for (let i = 0; i < opts.fixCount; i++) {
    positions.push({
      latitude: latAfterNorthMove(BASE_LAT, perSegmentM * i),
      longitude: BASE_LNG,
      accuracy: opts.accuracy,
      speed: speedMs,
      timestamp: new Date(opts.startTime.getTime() + i * opts.intervalSec * 1000),
    });
  }
  return positions;
}

/** Deux segments de fixes réguliers séparés par un trou de `gapSec` (app tuée/relancée). */
function buildTraceWithGap(opts: {
  startTime: Date;
  intervalSec: number;
  segmentDurationSec: number;
  gapSec: number;
  accuracy: number;
}): SyntheticPosition[] {
  const fixesPerSegment = Math.floor(opts.segmentDurationSec / opts.intervalSec) + 1;
  const positions: SyntheticPosition[] = [];
  for (let i = 0; i < fixesPerSegment; i++) {
    positions.push({
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracy: opts.accuracy,
      speed: 0,
      timestamp: new Date(opts.startTime.getTime() + i * opts.intervalSec * 1000),
    });
  }
  const segAEnd = opts.startTime.getTime() + opts.segmentDurationSec * 1000;
  const segBStart = segAEnd + opts.gapSec * 1000;
  for (let i = 0; i < fixesPerSegment; i++) {
    positions.push({
      latitude: BASE_LAT,
      longitude: BASE_LNG,
      accuracy: opts.accuracy,
      speed: 0,
      timestamp: new Date(segBStart + i * opts.intervalSec * 1000),
    });
  }
  return positions;
}

/**
 * Rejoue evaluateTeleportation() (teleportation.utils.ts) séquentiellement, EXACTEMENT
 * comme le fait le chemin temps réel/batch en production : la référence n'avance QUE
 * sur un point accepté (jamais sur un point suspect), pour ne pas comparer un point
 * légitime à un point aberrant qui l'a précédé.
 */
function markSuspects(positions: SyntheticPosition[]): (SyntheticPosition & { suspect: boolean })[] {
  const result: (SyntheticPosition & { suspect: boolean })[] = [];
  let reference: TeleportReference | null = null;
  for (const p of positions) {
    if (!reference) {
      result.push({ ...p, suspect: false });
      reference = { latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp };
      continue;
    }
    const evalRes = evaluateTeleportation(reference, p.latitude, p.longitude, p.timestamp, p.accuracy);
    result.push({ ...p, suspect: evalRes.suspect });
    if (!evalRes.suspect) {
      reference = { latitude: p.latitude, longitude: p.longitude, timestamp: p.timestamp };
    }
  }
  return result;
}

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

const mockPrisma = {
  fuelLog: { findFirst: jest.fn(), update: jest.fn() },
  gpsPosition: { findMany: jest.fn() },
  companyFuelSettings: { findUnique: jest.fn() },
};

const mockConfigService = { get: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockTrackingGateway = { broadcastDataUpdate: jest.fn() };

function makeFuelLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fuel-log-1',
    vehicleId: 'vehicle-1',
    kilometers: 50,
    fillDate: new Date('2026-08-01T14:00:00.000Z'),
    vehicle: { licensePlate: 'GPS-TEST', driver: { userId: null } },
    gpsCoverageInsufficientFlag: false,
    gpsCoverageInsufficientReason: null,
    ...overrides,
  };
}

describe('GPS ↔ Carburant — traces synthétiques (verrou de non-régression)', () => {
  let service: FuelConsumptionService;

  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigService.get.mockReturnValue(15);
    mockPrisma.companyFuelSettings.findUnique.mockResolvedValue({ crossCheckThreshold: 1.3 });
    mockPrisma.fuelLog.findFirst.mockResolvedValue(null);
    service = new FuelConsumptionService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
      mockNotifications as unknown as NotificationsService,
      mockQueue as unknown as any,
      mockTrackingGateway as any,
    );
  });

  // ---------------------------------------------------------------------------
  // Scénario 1 — trace continue et propre
  // ---------------------------------------------------------------------------
  describe('Scénario 1 — trace continue et propre (fix/3s sur 8h, accuracy < 20m)', () => {
    const REFERENCE_KM = 50;
    const positions = buildCleanTrace({
      startTime: new Date('2026-08-01T06:00:00.000Z'),
      intervalSec: 3,
      fixCount: (8 * 3600) / 3 + 1, // 9601 fixes sur 8h
      totalDistanceM: REFERENCE_KM * 1000,
      accuracy: 15,
    });

    it('computeFilteredDistance() reste dans ±5% de la distance de référence (trajet droit 50km)', () => {
      const gpsKm = computeFilteredDistance(positions) / 1000;
      const deviationPct = Math.abs(gpsKm - REFERENCE_KM) / REFERENCE_KM;
      expect(deviationPct).toBeLessThanOrEqual(0.05);
    });

    it("crossCheckFuelLogWithGps() ne pose AUCUNE anomalie (kilométrage saisi cohérent avec le GPS)", async () => {
      const fuelLog = makeFuelLog({ kilometers: REFERENCE_KM });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(positions);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gpsAnomalyFlag: true }) }),
      );
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gpsCoverageInsufficientFlag: true }),
        }),
      );
      expect(mockNotifications.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Scénario 2 — trou de 2h au milieu (app tuée puis relancée)
  // ---------------------------------------------------------------------------
  describe('Scénario 2 — trou de 2h au milieu (app tuée puis relancée)', () => {
    // 30 min de fixes propres + trou de 2h + 30 min de fixes propres (60s d'intervalle) :
    // coverage = (1800 + min(7200, 300) + 1800) / (1800 + 7200 + 1800) = 3900/10800 ≈ 0,361
    // — sous FUEL_COVERAGE_MIN_FRACTION (0,4), donc RÉELLEMENT insuffisant pour le garde-fou
    // de production (pas juste "< 0,9").
    const positions = buildTraceWithGap({
      startTime: new Date('2026-08-01T06:00:00.000Z'),
      intervalSec: 60,
      segmentDurationSec: 1800,
      gapSec: 2 * 3600,
      accuracy: 15,
    });

    it('computeGpsCoverageFraction() retourne < 0.9 (et, concrètement, sous le seuil réel de production)', () => {
      const coverage = (service as any).computeGpsCoverageFraction(positions);
      expect(coverage).toBeLessThan(0.9);
      expect(coverage).toBeLessThan(FUEL_COVERAGE_MIN_FRACTION);
    });

    it("crossCheckFuelLogWithGps() flague gpsCoverageInsufficientFlag AU LIEU de comparer les distances (pas de fausse anomalie)", async () => {
      const fuelLog = makeFuelLog({ kilometers: 40 }); // >= FUEL_COVERAGE_MIN_MANUAL_KM
      expect(fuelLog.kilometers).toBeGreaterThanOrEqual(FUEL_COVERAGE_MIN_MANUAL_KM);
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(positions);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-log-1' },
        data: {
          gpsCoverageInsufficientFlag: true,
          gpsCoverageInsufficientReason: expect.stringContaining('Couverture GPS insuffisante'),
        },
      });
      // Jamais la comparaison de distance (gpsAnomalyFlag) sur ce chemin : la fonction
      // retourne AVANT d'atteindre le calcul de ratio manuel/GPS.
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gpsAnomalyFlag: true }) }),
      );
      expect(mockPrisma.companyFuelSettings.findUnique).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Scénario 3 — saut téléporté isolé
  // ---------------------------------------------------------------------------
  describe('Scénario 3 — saut téléporté isolé (200km en 3s)', () => {
    const CLEAN_REFERENCE_KM = 5;
    const cleanPositions = buildCleanTrace({
      startTime: new Date('2026-08-01T06:00:00.000Z'),
      intervalSec: 30,
      fixCount: 20,
      totalDistanceM: CLEAN_REFERENCE_KM * 1000,
      accuracy: 20,
    });
    // Glitch inséré 3s après le fix #10 (bien avant le fix #11 réel à +30s) : distance
    // exorbitante (200km) sur un intervalle très court → doit être détecté "vitesse".
    const teleportPoint: SyntheticPosition = {
      latitude: latAfterNorthMove(cleanPositions[10].latitude, 200_000),
      longitude: cleanPositions[10].longitude,
      accuracy: 25,
      timestamp: new Date(cleanPositions[10].timestamp.getTime() + 3000),
    };
    const withGlitch = [...cleanPositions.slice(0, 11), teleportPoint, ...cleanPositions.slice(11)];
    const flagged = markSuspects(withGlitch);

    it('evaluateTeleportation() marque le point sauté comme suspect (raison "vitesse")', () => {
      const glitchEntry = flagged[11];
      expect(glitchEntry.latitude).toBe(teleportPoint.latitude);
      expect(glitchEntry.suspect).toBe(true);
    });

    it("l'exclusion du point suspect empêche gpsKm de gonfler (reste ≈ la distance réelle, pas ≈ +400km)", () => {
      const nonSuspect = flagged.filter((p) => !p.suspect);
      const gpsKmFiltered = computeFilteredDistance(nonSuspect) / 1000;
      const gpsKmUnfiltered = computeFilteredDistance(flagged) / 1000;

      expect(Math.abs(gpsKmFiltered - CLEAN_REFERENCE_KM)).toBeLessThan(0.5);
      // Sans l'exclusion, l'aller-retour de 200km vers le point suspect gonflerait
      // gpsKm de plusieurs centaines de km — la démonstration du contraste prouve
      // que le filtrage est bien ce qui protège gpsKm, pas un hasard de construction.
      expect(gpsKmUnfiltered).toBeGreaterThan(200);
    });

    it("crossCheckFuelLogWithGps() sur les positions filtrées (suspect=false, comme la requête Prisma réelle) ne pose aucune anomalie", async () => {
      const nonSuspect = flagged.filter((p) => !p.suspect);
      const fuelLog = makeFuelLog({ kilometers: CLEAN_REFERENCE_KM });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(nonSuspect);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gpsAnomalyFlag: true }) }),
      );
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gpsCoverageInsufficientFlag: true }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Scénario 4 — accuracy dégradée mais plausible (zone urbaine dense)
  // ---------------------------------------------------------------------------
  describe('Scénario 4 — accuracy dégradée mais plausible (30-80m, sans vitesse fournie)', () => {
    const ACCURACIES = [30, 45, 60, 80, 50, 35, 70]; // toutes dans [30, 80]
    const PER_SEGMENT_M = 20; // > seuil de bruit plafonné (7.5m, GPS_NOISE_MAX_ACCURACY_SCALE=1.5)
    const FIX_COUNT = 200;
    const REFERENCE_KM = (PER_SEGMENT_M * (FIX_COUNT - 1)) / 1000;

    const positions: SyntheticPosition[] = Array.from({ length: FIX_COUNT }, (_, i) => ({
      latitude: latAfterNorthMove(BASE_LAT, PER_SEGMENT_M * i),
      longitude: BASE_LNG,
      accuracy: ACCURACIES[i % ACCURACIES.length],
      // PAS de speed fourni : force le passage par le seuil de bruit pondéré par
      // l'accuracy dans computeFilteredDistance (pas la RÈGLE VITESSE) — c'est
      // précisément le chemin de code que ce scénario protège.
      timestamp: new Date(Date.now() + i * 3000),
    }));

    it('les positions dégradées (30-80m) sont conservées : gpsKm ≈ la distance réelle, aucune n\'est rejetée', () => {
      const gpsKm = computeFilteredDistance(positions) / 1000;
      expect(gpsKm).toBeCloseTo(REFERENCE_KM, 2);
    });

    it("crossCheckFuelLogWithGps() traite normalement ces positions (pas de flag couverture, pas de faux rejet)", async () => {
      const fuelLog = makeFuelLog({ kilometers: Math.round(REFERENCE_KM) });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce(positions);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ gpsCoverageInsufficientFlag: true }),
        }),
      );
      expect(mockPrisma.fuelLog.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gpsAnomalyFlag: true }) }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Scénario 5 — aucune position GPS sur la période
  // ---------------------------------------------------------------------------
  describe('Scénario 5 — aucune position GPS sur la période', () => {
    it('message exact "Aucune position GPS enregistrée..." + gpsCoverageInsufficientFlag=true', async () => {
      const fuelLog = makeFuelLog({ kilometers: 120 });
      mockPrisma.gpsPosition.findMany.mockResolvedValueOnce([]);

      await (service as any).crossCheckFuelLogWithGps(fuelLog, 'company-1');

      expect(mockPrisma.fuelLog.update).toHaveBeenCalledWith({
        where: { id: 'fuel-log-1' },
        data: {
          gpsCoverageInsufficientFlag: true,
          gpsCoverageInsufficientReason: expect.stringContaining('Aucune position GPS enregistrée'),
        },
      });
      expect(mockNotifications.create).toHaveBeenCalledWith(
        'company-1',
        expect.objectContaining({ type: 'fuel_gps_coverage_missing' }),
      );
    });
  });
});
