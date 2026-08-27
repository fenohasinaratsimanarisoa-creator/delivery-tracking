import { haversineDistance, GPS_NOISE_MAX_ACCURACY_SCALE } from './geo.utils';

// Constantes de détection de téléportation — SOURCE UNIQUE DE VÉRITÉ, partagée entre
// le chemin temps réel (savePosition) et le chemin batch (saveBatch, rattrapage réseau
// de l'app mobile) pour garantir le même `suspect` sur le même (référence, point).
export const TELEPORT_SPEED_THRESHOLD_MS = 55.56;
export const TELEPORT_DISTANCE_THRESHOLD_M = 5000;
export const TELEPORT_TIME_THRESHOLD_S = 10;

export interface TeleportReference {
  latitude: number;
  longitude: number;
  timestamp: Date;
}

export interface TeleportEvaluation {
  suspect: boolean;
  reason: 'non_croissant' | 'vitesse' | 'saut_court' | null;
  timeDiffSec: number;
  distance: number;
  speedMs: number;
}

/**
 * Décision UNIQUE de détection de téléportation, partagée entre detectTeleportation()
 * (temps réel) et saveBatch() (rattrapage réseau de l'app mobile). Sans ce point commun,
 * un même type d'anomalie GPS pouvait produire un historique différent selon le chemin
 * d'entrée — problématique pour un audit après coup ou un litige chauffeur.
 *
 * POLITIQUE des timestamps non croissants (documentée, identique dans les deux chemins) :
 * les deux chemins rejettent d'abord les points dont l'écart est <= 1s (fenêtre de
 * dédoublonnage isDuplicateByTimestamp en temps réel / timeDiffSec <= DEDUP_CLOCK_SKEW_S en
 * batch) AVANT d'appeler cette fonction. Un timestamp non croissant est donc traité comme une
 * retransmission/doublon (rejeté), pas comme une anomalie. La branche 'non_croissant' ci-dessous
 * est une garde DÉFENSIVE pour un éventuel appelant qui contournerait le dédoublonnage.
 */
export function evaluateTeleportation(
  reference: TeleportReference,
  latitude: number,
  longitude: number,
  timestamp: Date,
  accuracy?: number,
): TeleportEvaluation {
  const timeDiffSec = (timestamp.getTime() - reference.timestamp.getTime()) / 1000;
  if (timeDiffSec <= 0) {
    return { suspect: true, reason: 'non_croissant', timeDiffSec, distance: 0, speedMs: 0 };
  }

  const distance = haversineDistance(reference.latitude, reference.longitude, latitude, longitude);
  const speedMs = distance / timeDiffSec;

  // Si l'accuracy est dégradée, l'apparente téléportation peut être du bruit GPS :
  // le seuil de SAUT COURT (distance, ci-dessous) reste échelonné par l'accuracy
  // (même échelle que computeFilteredDistance), PLAFONNÉ (GPS_NOISE_MAX_ACCURACY_SCALE
  // = 1.5 — cohérent avec le filtre de bruit geo.utils, source unique).
  const accuracyScale = accuracy
    ? Math.max(1, Math.min(accuracy / 10, GPS_NOISE_MAX_ACCURACY_SCALE))
    : 1;
  const adjustedDistanceThreshold = TELEPORT_DISTANCE_THRESHOLD_M * accuracyScale;

  // BUG CORRIGÉ (audit terrain 2026-08-27, confirmé sur données réelles en production) :
  // le seuil de VITESSE était lui aussi échelonné par l'accuracy (jusqu'à 55,56 × 1,5 =
  // 83 m/s = 300 km/h) — pensé pour éviter les faux positifs sur du bruit GPS avec
  // accuracy dégradée. Cas réel : chauffeur resté chez lui toute la nuit, téléphone
  // immobile en intérieur — un saut GPS de 720 m en 9 s (≈80 m/s = 288 km/h, physiquement
  // impossible pour un véhicule) avec une accuracy de seulement 20,9 m (scale plafonné à
  // 1,5, seuil relevé à 300 km/h) est passé SOUS ce seuil élargi → suspect=false → le
  // point a alimenté le calcul de distance carburant sans aucun garde-fou, contribuant à
  // un rapport de 68 km pour un véhicule qui n'a pas bougé. Aucun véhicule de flotte réel
  // ne dépasse 200 km/h (TELEPORT_SPEED_THRESHOLD_MS) : contrairement au seuil de
  // distance ci-dessous (qui protège un usage GPS générique plus large), la vitesse reste
  // désormais NON échelonnée — un point dont l'accuracy est dégradée au point de sembler
  // franchir 200 km/h est du bruit, jamais un déplacement réel.
  if (speedMs > TELEPORT_SPEED_THRESHOLD_MS) {
    return { suspect: true, reason: 'vitesse', timeDiffSec, distance, speedMs };
  }

  // Saut court : grande distance sur un intervalle très court, même si la vitesse moyenne
  // reste sous le seuil (accuracy dégradée). Avec les constantes actuelles (5000m, 10s,
  // 55.56 m/s, scale >= 1), cette règle est redondante avec la règle de vitesse — on la
  // conserve PARTAGÉE pour garantir l'équivalence temps réel / batch et la robustesse si
  // les constantes évoluent.
  if (distance > adjustedDistanceThreshold && timeDiffSec < TELEPORT_TIME_THRESHOLD_S) {
    return { suspect: true, reason: 'saut_court', timeDiffSec, distance, speedMs };
  }

  return { suspect: false, reason: null, timeDiffSec, distance, speedMs };
}
