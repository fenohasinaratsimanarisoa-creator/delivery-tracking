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
/** Plafond d'appels OSRM par défaut — borne le pire cas (trace très dense/longue). */
export const MAX_MATCH_CHUNKS = 80;
/**
 * Au-delà de cet écart (s) entre deux fixes CONSÉCUTIFS du flux collapsé, on
 * force une frontière de morceau (audit terrain 2026-09-15, cas réel « chunk
 * 5 ») : collapseStationaryWindows() ne fusionne que les arrêts DENSÉMENT
 * échantillonnés (fixes ≤ 60 s d'écart) — un arrêt long avec seulement
 * quelques pings épars (ex. 10:36, 11:55, 12:05, soit 79 min puis 10 min
 * d'écart) reste tel quel dans le flux collapsé. Sans cette coupure, ces
 * points épars se retrouvaient mélangés dans le MÊME morceau fixe de
 * MATCH_CHUNK_SIZE qu'une vraie conduite dense qui suivait — le morceau
 * couvrait alors 1h41 pour 80 points, avec un saut temporel énorme en son
 * milieu, qu'OSRM ne pouvait pas matcher (confiance nulle ou scindé) : LA
 * VRAIE CONDUITE (plusieurs km) qui suivait l'arrêt retombait alors sur
 * computeFilteredDistance pour tout le morceau au lieu d'être accrochée
 * route. Repris de FUEL_COVERAGE_GAP_TOLERANCE_S (même seuil, déjà établi
 * ailleurs pour distinguer un trou de couverture d'un trajet continu).
 */
export const MATCH_LEG_GAP_S = 300;

/**
 * Budget PARTAGEABLE entre plusieurs appels de computeRouteMatchedDistance
 * (audit sous-comptage carburant 2026-09-15, extension scanVehicleTrack).
 * scanVehicleTrack() pagine une fenêtre pouvant courir sur plusieurs SEMAINES
 * (fenêtre entre deux pleins, jusqu'à 30 j de repli pour le tout premier
 * plein d'un véhicule) — sans budget PARTAGÉ entre pages, chaque page de
 * 20 000 positions relancerait son propre plafond de MAX_MATCH_CHUNKS appels
 * OSRM, multipliant le total par le nombre de pages. Créer UN SEUL objet
 * `{ remaining: MAX_MATCH_CHUNKS }` avant la boucle de pagination et le
 * passer à chaque appel borne le total RÉEL d'appels OSRM pour tout le scan,
 * quel que soit le nombre de pages.
 */
export interface MatchBudget {
  remaining: number;
}

export async function computeRouteMatchedDistance(
  positions: RouteDistanceFix[],
  matchFn: MatchDistanceFn,
  budget: MatchBudget = { remaining: MAX_MATCH_CHUNKS },
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
  let i = 0;
  while (i < collapsed.length - 1) {
    const hardEnd = Math.min(i + MATCH_CHUNK_SIZE, collapsed.length);
    // Frontière au premier écart temporel > MATCH_LEG_GAP_S rencontré AVANT
    // le plafond de taille (voir commentaire de la constante) — j pointe sur
    // le premier fix APRÈS le trou, exclu de ce morceau.
    let j = i + 1;
    while (j < hardEnd) {
      const gapS = (collapsed[j].timestamp.getTime() - collapsed[j - 1].timestamp.getTime()) / 1000;
      if (gapS > MATCH_LEG_GAP_S) break;
      j++;
    }
    const stoppedForGap = j < hardEnd;
    const chunk = collapsed.slice(i, j);

    if (chunk.length >= MATCH_MIN_FIXES && budget.remaining > 0) {
      budget.remaining--;
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

    if (j >= collapsed.length) break;

    if (stoppedForGap) {
      // Coupure « réelle » (trou de données) : le segment qui l'enjambe est
      // décidé par les règles standard de computeFilteredDistance (vitesse /
      // seuil de bruit), jamais par OSRM — pas d'overlap artificiel ici, le
      // morceau suivant repart proprement du fix qui suit le trou.
      total += computeFilteredDistance([collapsed[j - 1], collapsed[j]]);
      i = j;
    } else {
      // Coupure « artificielle » (plafond de taille) : chevauchement d'1
      // point pour que le segment de jonction ne soit ni perdu ni doublé.
      i = j - 1;
    }
  }
  return total;
}
