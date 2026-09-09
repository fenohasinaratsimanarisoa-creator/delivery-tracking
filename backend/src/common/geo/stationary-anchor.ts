import { haversineDistance, STATIONARY_SPEED_MS } from './geo.utils';

// ─────────────────────────────────────────────────────────────────────────────
// ANCRE À L'ARRÊT (audit PRÉCISION GPS PHYSIQUE 2026-09-09)
//
// Symptôme : moto GARÉE → position affichée qui DÉRIVE de ~50-100 m au fil des
// fixes faibles (5-7 satellites), le dernier fix reçu (souvent le pire) devenant
// la position courante.
//
// `computeAnchoredPosition` calcule la position à AFFICHER quand le véhicule est
// à l'arrêt : le CENTROÏDE PONDÉRÉ (1/accuracy²) de la SÉRIE CONTIGUË de fixes à
// l'arrêt qui précède le fix courant. Les fixes à 14-15 sat pèsent ~4× plus que
// ceux à 7 sat, ~300× plus que ceux à 4 sat → position STABLE, recalée sur les
// bons fixes, au lieu d'un marqueur qui saute.
//
// N'affecte QUE l'affichage (broadcast + /tracking/live). Les positions stockées
// dans gps_positions restent BRUTES (téléportation, rapports, litiges chauffeur).
// ─────────────────────────────────────────────────────────────────────────────

export interface AnchorFix {
  latitude: number;
  longitude: number;
  /** m — accuracy estimée du fix (computeCombinedAccuracy). */
  accuracy?: number | null;
  /** m/s — vitesse sol résolue si connue. */
  speed?: number | null;
  /** true = device « en mouvement », false = « à l'arrêt », null/undefined = inconnu. */
  motion?: boolean | null;
  timestamp: Date;
}

/** Ancienneté max (depuis le fix courant) d'un fix pris dans la série d'arrêt. */
export const ANCHOR_WINDOW_MS = 90 * 60_000;
/** En-deçà, pas assez de matière pour ancrer → on garde la position brute. */
export const ANCHOR_MIN_FIXES = 2;
/** Un fix plus loin que ça du fix courant appartient à un AUTRE arrêt / trajet. */
export const ANCHOR_INITIAL_RADIUS_MIN_M = 150;
export const ANCHOR_INITIAL_RADIUS_ACC_MULT = 4;
/** Rayon (autour du meilleur fix) du cluster finalement pondéré. */
export const ANCHOR_CLUSTER_RADIUS_MIN_M = 60;
export const ANCHOR_CLUSTER_RADIUS_ACC_MULT = 3;
/** Accuracy plancher pour la pondération (un fix ne « vaut » jamais mieux que 5 m). */
export const ANCHOR_ACCURACY_FLOOR_M = 5;

const accOf = (f: AnchorFix): number => (f.accuracy != null && f.accuracy > 0 ? f.accuracy : 50);

/** true si le fix indique un véhicule à l'arrêt. */
export function isStoppedFix(f: AnchorFix): boolean {
  if (f.motion === true) return false;
  if (f.motion === false) return true;
  return f.speed == null || f.speed < STATIONARY_SPEED_MS;
}

/**
 * Position à AFFICHER pour un véhicule à l'arrêt, ou `null` si :
 *  - le véhicule est en mouvement (dernier fix) → utiliser la position brute / map-matchée ;
 *  - pas assez de fixes fiables dans la série d'arrêt courante.
 *
 * @param fixes historique récent (ordre quelconque), le plus récent fait foi.
 */
export function computeAnchoredPosition(
  fixes: AnchorFix[],
): { latitude: number; longitude: number } | null {
  if (!Array.isArray(fixes) || fixes.length < ANCHOR_MIN_FIXES) return null;

  const sorted = [...fixes]
    .filter((f) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  if (sorted.length < ANCHOR_MIN_FIXES) return null;

  const newest = sorted[sorted.length - 1];
  if (!isStoppedFix(newest)) return null;

  const initialRadius = Math.max(
    ANCHOR_INITIAL_RADIUS_MIN_M,
    ANCHOR_INITIAL_RADIUS_ACC_MULT * accOf(newest),
  );

  // Série CONTIGUË de fixes à l'arrêt qui précède le fix courant : on remonte tant
  // que le fix reste « à l'arrêt », proche, et dans la fenêtre de temps. Le premier
  // fix en mouvement / lointain / trop vieux STOPPE la remontée (l'arrêt courant a
  // commencé après lui).
  const run: AnchorFix[] = [newest];
  for (let i = sorted.length - 2; i >= 0; i--) {
    const f = sorted[i];
    if (newest.timestamp.getTime() - f.timestamp.getTime() > ANCHOR_WINDOW_MS) break;
    if (!isStoppedFix(f)) break;
    if (
      haversineDistance(newest.latitude, newest.longitude, f.latitude, f.longitude) > initialRadius
    )
      break;
    run.push(f);
  }
  if (run.length < ANCHOR_MIN_FIXES) return null;

  // Pivot = le fix le plus précis de la série ; on resserre autour de lui.
  const pivot = run.reduce((best, f) => (accOf(f) < accOf(best) ? f : best), run[0]);
  const clusterRadius = Math.max(
    ANCHOR_CLUSTER_RADIUS_MIN_M,
    ANCHOR_CLUSTER_RADIUS_ACC_MULT * accOf(pivot),
  );
  const cluster = run.filter(
    (f) =>
      haversineDistance(pivot.latitude, pivot.longitude, f.latitude, f.longitude) <= clusterRadius,
  );
  if (cluster.length < ANCHOR_MIN_FIXES) return null;

  let wSum = 0;
  let latSum = 0;
  let lngSum = 0;
  for (const f of cluster) {
    const a = Math.max(ANCHOR_ACCURACY_FLOOR_M, accOf(f));
    const w = 1 / (a * a);
    wSum += w;
    latSum += f.latitude * w;
    lngSum += f.longitude * w;
  }
  if (!(wSum > 0)) return null;

  return { latitude: latSum / wSum, longitude: lngSum / wSum };
}
