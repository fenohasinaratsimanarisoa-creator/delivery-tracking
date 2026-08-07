// Seuil de bruit GPS : en dessous de 5m entre deux positions consécutives, on
// considère qu'il s'agit de bruit de réception (dérive à l'arrêt) et non d'un
// déplacement réel. SOURCE UNIQUE DE VÉRITÉ pour ce seuil : utilisé à la fois par
// generateDailyReportForDriver() (fuel-consumption.service.ts) et par
// calculateDistance()/calculateDistancePostGIS() (tracking.service.ts) afin que le
// rapport carburant et le rapport de trajet affichent la MÊME distance pour le
// même trajet. Ce seuil est cohérent avec le scale d'accuracy utilisé dans
// detectTeleportation (backend tracking.service.ts) où une accuracy de 10m donne
// un scale de 1.
export const GPS_NOISE_THRESHOLD_M = 5;

// Plafond de l'échelle d'accuracy appliquée au seuil de bruit (accuracy/10, plancher 1).
// Sans plafond, une précision dégradée (20-80m, fréquente en ville/centre-ville) élevait
// le seuil à 10-40 m et supprimait des segments RÉELS de circulation lente (10-30m entre
// deux fixes à INTERVAL_FAST=3s) — sous-corrigeant la distance d'un facteur 2 à 5 (ex.
// 50 km réels → ~10 km au rapport). Cap à 1.5 → le seuil ne dépasse jamais 7,5 m.
export const GPS_NOISE_MAX_ACCURACY_SCALE = 1.5;

// Vitesse (m/s) au-dessus de laquelle un segment est considéré comme un déplacement réel
// (toujours compté, quelle que soit sa longueur). 1.0 m/s ≈ 3.6 km/h : nettement au-dessus
// du bruit de vitesse d'un téléphone à l'arrêt, mais bien en dessous d'une progression
// réelle en circulation (embouteillage ≈ 2-5 m/s). C'est la RÈGLE VITESSE qui permet enfin
// de distinguer « dérive à l'arrêt » (vitesse≈0, petit segment) de « déplacement lent »
// (vitesse>0, petit segment) — la longueur seule ne pouvait pas.
export const MOVEMENT_SPEED_THRESHOLD_MS = 1.0;

/**
 * Distance cumulée d'un trajet en filtrant le bruit GPS, avec un seuil pondéré par
 * l'accuracy moyenne de chaque segment ET plafonné (GPS_NOISE_MAX_ACCURACY_SCALE).
 *
 * SOURCE UNIQUE DE VÉRITÉ pour le calcul de distance filtrée : utilisé à la fois par
 * generateDailyReportForDriver()/upsertDailyReportForVehicleGroup() (fuel-consumption) et
 * par calculateDistance() (tracking) afin que le rapport carburant et le rapport de trajet
 * restent cohérents pour le même (véhicule, jour).
 *
 * RÈGLE VITESSE (corrige le sous-comptage massif) : si l'une des deux extrémités d'un
 * segment est en mouvement (speed > MOVEMENT_SPEED_THRESHOLD_MS), le segment est TOUJOURS
 * compté, même sous le seuil de distance. L'ancienne logique (seuil 5m × max(1, accuracy/10)
 * SANS plafond) supprimait les segments courts des trajets urbains lents — un véhicule à
 * 10-30 km/h couvre 8-25 m en 3 s, sous les thresholds 15-40 m induits par une accuracy
 * dégradée. La vitesse authentifie le déplacement : elle est fournie par le mobile
 * (coords.speed) et par Traccar (noeuds → m/s) et stockée dans gps_positions.speed.
 *
 * RÈGLE SEUIL (conservée pour l'arrêt) : sans vitesse (ou vitesse≈0 → véhicule à l'arrêt),
 * on filtre le bruit de dérive avec le seuil pondéré par l'accuracy, plafonné à
 * GPS_NOISE_MAX_ACCURACY_SCALE (→ max 7,5 m) pour ne jamais effacer un réel court trajet.
 *
 * DÉVIATION ASSUMÉE vs calculateDistancePostGIS : celui-ci garde un seuil FIXE à 5m (aucune
 * pondération accuracy) — acceptable, car le PostGIS ne sert qu'au rapport de trajet
 * complémentaire, pas au rapport carburant.
 */
export function computeFilteredDistance(
  positions: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
  }>,
): number {
  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const p1 = positions[i - 1];
    const p2 = positions[i];
    const segDist = haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

    // RÈGLE VITESSE : un déplacement avéré est compté intégralement.
    const moving =
      (p1.speed != null && p1.speed > MOVEMENT_SPEED_THRESHOLD_MS) ||
      (p2.speed != null && p2.speed > MOVEMENT_SPEED_THRESHOLD_MS);
    if (moving) {
      totalDistance += segDist;
      continue;
    }

    // Pas de déplacement (arrêt ou vitesse inconnue) : filtre la dérive avec le seuil.
    const avgAccuracy =
      p1.accuracy != null && p2.accuracy != null
        ? (p1.accuracy + p2.accuracy) / 2
        : (p1.accuracy ?? p2.accuracy ?? 0);
    const scale =
      avgAccuracy > 0 ? Math.max(1, Math.min(avgAccuracy / 10, GPS_NOISE_MAX_ACCURACY_SCALE)) : 1;
    const threshold = GPS_NOISE_THRESHOLD_M * scale;
    if (segDist >= threshold) {
      totalDistance += segDist;
    }
  }
  return totalDistance;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
