import { collapseStationaryWindows, computeFilteredDistance } from './geo.utils';
import { matchRadiuses, MATCH_MIN_CONFIDENCE, MATCH_MIN_FIXES } from './live-map-match';

// ─────────────────────────────────────────────────────────────────────────────
// DISTANCE ACCROCHÉE ROUTE POUR LE RAPPORT CARBURANT (audit sous-comptage
// 2026-09-15). computeFilteredDistance() (geo.utils.ts) travaille point à
// point et ne peut jamais dépasser la somme des CORDES entre fixes bruts —
// même sans aucun filtrage, une trace échantillonnée toutes les quelques
// secondes reste plus courte que la vraie route (virages entre deux fixes).
// Cas réel : 976 fixes / jour, corde brute totale 37,1 km, odomètre 42 km.
//
// `computeRouteMatchedDistance` découpe la journée en morceaux de taille
// exploitable par OSRM /match (MATCH_CHUNK_SIZE, chevauchement d'1 point pour
// ne rien perdre aux frontières) et accroche chaque morceau au réseau routier
// réel via `matchFn` (RoutingService.matchRouteDistance, injecté — jamais
// appelé en dur ici, pour rester testable sans OSRM). Un morceau qui échoue
// (OSRM indisponible, confiance insuffisante, trace scindée) retombe
// individuellement sur computeFilteredDistance — jamais pire que l'ancien
// comportement, jamais de trou silencieux.
//
// `collapseStationaryWindows` est appliqué EN AMONT sur la journée entière :
// un arrêt de plusieurs heures (garé le midi) redevient un point unique avant
// découpage, au lieu d'imposer des dizaines de points quasi-identiques à
// OSRM (qui dégraderaient la qualité du matching sans rien apporter).
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteDistanceFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  timestamp?: Date | null;
}

export interface MatchDistanceResult {
  /** mètres */
  distance: number;
  confidence: number;
}

/** Injecté par l'appelant (RoutingService.matchRouteDistance) — jamais appelé en dur ici. */
export type MatchDistanceFn = (
  coordinates: [number, number][],
  radiuses: number[],
) => Promise<MatchDistanceResult | null>;

/** Points par appel OSRM /match — sous la limite pratique OSRM et le plafond DTO (1000). */
export const MATCH_CHUNK_SIZE = 80;
/** Plafond d'appels OSRM par (véhicule, jour) — borne le pire cas (trace très dense/longue). */
export const MAX_MATCH_CHUNKS = 80;

export async function computeRouteMatchedDistance(
  positions: RouteDistanceFix[],
  matchFn: MatchDistanceFn,
): Promise<number> {
  const withTimestamps = positions.filter(
    (p): p is RouteDistanceFix & { timestamp: Date } => p.timestamp instanceof Date,
  );
  if (withTimestamps.length < 2) {
    return computeFilteredDistance(positions);
  }
  const sorted = [...withTimestamps].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const collapsed = collapseStationaryWindows(sorted);

  let total = 0;
  let chunksUsed = 0;
  let i = 0;
  while (i < collapsed.length - 1) {
    const end = Math.min(i + MATCH_CHUNK_SIZE, collapsed.length);
    const chunk = collapsed.slice(i, end);

    if (chunk.length >= MATCH_MIN_FIXES && chunksUsed < MAX_MATCH_CHUNKS) {
      chunksUsed++;
      let matched: MatchDistanceResult | null = null;
      try {
        matched = await matchFn(
          chunk.map((f) => [f.latitude, f.longitude] as [number, number]),
          matchRadiuses(chunk),
        );
      } catch {
        matched = null;
      }
      total +=
        matched && matched.confidence >= MATCH_MIN_CONFIDENCE
          ? matched.distance
          : computeFilteredDistance(chunk);
    } else {
      total += computeFilteredDistance(chunk);
    }

    if (end >= collapsed.length) break;
    i = end - 1; // chevauchement d'1 point : le segment de jonction n'est ni perdu ni doublé
  }
  return total;
}
