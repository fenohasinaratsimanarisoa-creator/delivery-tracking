import { collapseStationaryWindows, computeFilteredDistance } from './geo.utils';
import { matchRadiuses, MATCH_MIN_FIXES } from './live-map-match';

/**
 * Confiance OSRM minimale pour retenir la distance d'un morceau ACCROCHÉE
 * ROUTE (audit sous-comptage carburant, volet confiance, 2026-09-15 bis).
 *
 * Ce module réutilisait jusqu'ici `MATCH_MIN_CONFIDENCE` (0,5) de
 * `live-map-match.ts` — un seuil calibré pour l'AFFICHAGE TEMPS RÉEL du
 * marqueur : une confiance faible y signale qu'OSRM a pu accrocher le point
 * sur la MAUVAISE rue parallèle, ce qui est visible et gênant sur la carte.
 * C'est un besoin différent de celui-ci (distance CUMULÉE d'un morceau) : la
 * confiance d'OSRM mesure l'ambiguïté du CHOIX de route entre plusieurs
 * candidates plausibles, pas la fiabilité de la LONGUEUR totale — deux rues
 * parallèles sur le même tronçon ont une longueur quasi identique. Vérifié
 * sur la trace réelle du 14/09 (976 fixes, odomètre moto 42 km) : les
 * morceaux à confiance 0,13 à 0,30 (rejetés par le seuil 0,5, donc retombés
 * sur le calcul brut) avaient tous une distance accrochée cohérente avec les
 * morceaux à haute confiance (+15 à +20 % par rapport à la corde brute — le
 * déficit normal de coupe d'angle d'une trace point-à-point), jamais une
 * valeur aberrante. Réutiliser le seuil d'affichage ici rejetait ces morceaux
 * à tort et retombait sur `computeFilteredDistance`, qui SOUS-compte
 * structurellement (jamais plus que la somme des cordes) : sur cette
 * journée, ce seul seuil coûtait ~1,4 km des ~3,6 km d'écart avec l'odomètre
 * (38,4 km calculés au lieu de ~39,8 km possibles).
 *
 * Seuil bas mais non nul : garde-fou minimal contre une confiance quasi
 * nulle (dégénérée) sans re-rejeter les cas réels observés. Le filet
 * anti-anomalie de plus haut niveau (déplacement net vs distance cumulée,
 * voir `isStationaryNoise` dans fuel-consumption.service.ts) reste la
 * protection contre un accrochage réellement aberrant.
 */
export const ROUTE_MATCH_MIN_CONFIDENCE = 0.05;

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
    const end = Math.min(i + MATCH_CHUNK_SIZE, collapsed.length);
    const chunk = collapsed.slice(i, end);

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
        matched && matched.confidence >= ROUTE_MATCH_MIN_CONFIDENCE
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
