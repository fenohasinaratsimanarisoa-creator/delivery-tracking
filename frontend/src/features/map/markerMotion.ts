/**
 * Garde-fous de MOUVEMENT du marqueur (audit « en mouvement → à l'arrêt → retour en
 * arrière » 2026-09-19). Fonctions pures, testées : RealTimeMap ne fait que les appeler.
 *
 * Deux sources de recul visuel indépendantes de tout bug de vitesse serveur :
 *  1. le dead reckoning FAIT AVANCER le marqueur au-delà du dernier fix réel puis, la
 *     fenêtre expirée, le ramenait d'un coup sur ce fix réel (recul garanti à chaque
 *     fix un peu tardif d'un traceur qui émet toutes les 5-20 s) ;
 *  2. le fix réel suivant, mesuré derrière le marqueur déjà extrapolé (ou bruité par le
 *     GPS), faisait glisser le marqueur en arrière.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const M_PER_DEG = 111_320;

/** Vecteur a→b en mètres (approximation locale, suffisante à l'échelle d'un trajet). */
function vecM(a: LatLng, b: LatLng): { x: number; y: number } {
  const cos = Math.cos((a.lat * Math.PI) / 180);
  return { x: (b.lng - a.lng) * M_PER_DEG * cos, y: (b.lat - a.lat) * M_PER_DEG };
}

/** Recul maximal (m) traité comme du bruit / une avance fictive : au-delà, c'est une vraie correction. */
export const MAX_BACKWARD_HOLD_M = 40;
/** Recul ignoré sous ce seuil de projection (m) — bruit de calcul. */
export const BACKWARD_EPSILON_M = 2;
/** Déplacement réel minimal (m) entre les deux derniers fixes pour connaître le sens de marche. */
export const MIN_TRAVEL_M = 4;
/** Nombre max de fixes consécutifs « retenus » avant d'accepter la correction (jamais figé indéfiniment). */
export const MAX_CONSECUTIVE_HOLDS = 3;

/**
 * true si le prochain fix ferait RECULER le marqueur par rapport au sens de marche
 * (dernier déplacement réel prevReal → lastReal) d'au plus MAX_BACKWARD_HOLD_M.
 * Dans ce cas l'appelant GARDE le marqueur où il est jusqu'à ce qu'un fix le
 * dépasse — le marqueur n'avance jamais « puis revient ».
 */
export function isBackwardJitter(
  prevReal: LatLng | null,
  lastReal: LatLng | null,
  current: LatLng,
  next: LatLng,
  maxBackM: number = MAX_BACKWARD_HOLD_M,
): boolean {
  if (!prevReal || !lastReal) return false;
  const travel = vecM(prevReal, lastReal);
  const travelLen = Math.hypot(travel.x, travel.y);
  if (travelLen < MIN_TRAVEL_M) return false;
  const step = vecM(current, next);
  const proj = (step.x * travel.x + step.y * travel.y) / travelLen;
  return proj < -BACKWARD_EPSILON_M && -proj <= maxBackM;
}

/** Distance max (m) dont le marqueur peut être avancé de façon FICTIVE par dead reckoning. */
export const MAX_DEAD_RECKON_DISTANCE_M = 30;

/**
 * Horizon (ms) de l'extrapolation : le plus petit de l'horizon temporel `maxMs` et du
 * temps nécessaire pour parcourir MAX_DEAD_RECKON_DISTANCE_M à `speedMs`. Sans ce
 * plafond, à 8 m/s le marqueur pouvait être avancé de 120 m sur une position inventée.
 */
export function deadReckonHorizonMs(speedMs: number, maxMs: number): number {
  if (!(speedMs > 0) || !(maxMs > 0)) return 0;
  return Math.min(maxMs, Math.round((MAX_DEAD_RECKON_DISTANCE_M / speedMs) * 1000));
}
