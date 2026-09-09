import { haversineDistance } from './geo.utils';

// ─────────────────────────────────────────────────────────────────────────────
// MAP-MATCHING TEMPS RÉEL (audit PRÉCISION GPS PHYSIQUE 2026-09-09, déploiement 2)
//
// Symptôme : en suivi temps réel, le véhicule apparaît HORS de la route (fix GPS
// à 10-30 m de côté). On accroche la position AFFICHÉE à la route via OSRM
// (/match) — sur une fenêtre glissante des derniers fixes, on prend le point
// accroché du dernier fix.
//
// N'affecte QUE l'affichage (displayLatitude/displayLongitude du broadcast). Le
// stockage gps_positions reste BRUT.
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

/** Nombre de fixes minimum pour tenter un accrochage (OSRM /match a besoin d'un tracé). */
export const MATCH_MIN_FIXES = 4;
/** Taille max de la fenêtre envoyée à OSRM. */
export const MATCH_WINDOW_SIZE = 8;
/** En-dessous, le résultat OSRM n'est pas assez fiable → on garde la position brute. */
export const MATCH_MIN_CONFIDENCE = 0.5;
/** Le point accroché ne doit pas être trop loin du fix brut (sinon OSRM a sauté
 *  sur une route parallèle) → on garde la position brute. */
export const MATCH_MAX_SNAP_DISTANCE_M = 50;
/** Rayon de recherche OSRM par point (m) — borné pour ne pas rater / trop élargir. */
export const MATCH_RADIUS_MIN_M = 15;
export const MATCH_RADIUS_MAX_M = 50;

/**
 * Fenêtre de fixes (chronologiques, plus récent en dernier) à envoyer à OSRM,
 * ou `null` s'il n'y en a pas assez.
 */
export function selectMatchWindow(fixes: MatchFix[]): MatchFix[] | null {
  if (!Array.isArray(fixes) || fixes.length < MATCH_MIN_FIXES) return null;
  return fixes.slice(-MATCH_WINDOW_SIZE);
}

/** Rayon de recherche OSRM par point de la fenêtre. */
export function matchRadiuses(window: MatchFix[]): number[] {
  return window.map((f) => {
    const a = f.accuracy != null && f.accuracy > 0 ? f.accuracy : 25;
    return Math.round(Math.max(MATCH_RADIUS_MIN_M, Math.min(MATCH_RADIUS_MAX_M, a)));
  });
}

/**
 * Valide le point accroché renvoyé par OSRM. Retourne la position accrochée
 * `{latitude, longitude}` si elle est fiable, sinon `null` (→ garder le brut) :
 *  - confiance OSRM suffisante ;
 *  - point accroché pas trop loin du fix brut.
 */
export function acceptSnappedTail(
  rawLast: { latitude: number; longitude: number },
  snappedTail: [number, number] | null | undefined,
  confidence: number,
): { latitude: number; longitude: number } | null {
  if (
    !snappedTail ||
    !Number.isFinite(snappedTail[0]) ||
    !Number.isFinite(snappedTail[1]) ||
    !(confidence >= MATCH_MIN_CONFIDENCE)
  ) {
    return null;
  }
  const [latitude, longitude] = snappedTail;
  if (
    haversineDistance(rawLast.latitude, rawLast.longitude, latitude, longitude) >
    MATCH_MAX_SNAP_DISTANCE_M
  ) {
    return null;
  }
  return { latitude, longitude };
}
