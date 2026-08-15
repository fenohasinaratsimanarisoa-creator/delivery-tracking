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
  // les seuils sont échelonnés par l'accuracy (même échelle que computeFilteredDistance),
  // MAIS PLAFONNÉS (GPS_NOISE_MAX_ACCURACY_SCALE = 1.5 — cohérent avec le filtre de bruit
  // geo.utils, source unique). Sans plafond, un traceur inconnu rapportant une accuracy
  // aberrante (ex. 500m, ou le repli 50m de computeCombinedAccuracy pour un device sans
  // accuracy) gonflait le seuil de vitesse à x5-50 (277-2778 m/s) → la détection de
  // téléportation était désactivée EN PRATIQUE (faux négatifs : vrais sauts GPS non
  // signalés). Le plafond 1.5 borne le seuil à 83 m/s (300 km/h) — jamais atteint par un
  // véhicule réel (aucun faux positif), mais un vrai saut reste toujours détecté.
  const accuracyScale = accuracy
    ? Math.max(1, Math.min(accuracy / 10, GPS_NOISE_MAX_ACCURACY_SCALE))
    : 1;
  const adjustedSpeedThreshold = TELEPORT_SPEED_THRESHOLD_MS * accuracyScale;
  const adjustedDistanceThreshold = TELEPORT_DISTANCE_THRESHOLD_M * accuracyScale;

  if (speedMs > adjustedSpeedThreshold) {
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
