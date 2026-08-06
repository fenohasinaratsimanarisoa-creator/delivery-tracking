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

/**
 * Distance cumulée d'un trajet en filtrant le bruit GPS, avec un seuil pondéré par
 * l'accuracy moyenne de chaque segment.
 *
 * SOURCE UNIQUE DE VÉRITÉ pour le calcul de distance filtrée : utilisée à la fois par
 * generateDailyReportForDriver()/upsertDailyReportForVehicleGroup() (fuel-consumption) et
 * par calculateDistance() (tracking) afin que le rapport carburant et le rapport de trajet
 * restent cohérents pour le même (véhicule, jour). Le seuil FIXE de 5m laissait passer le
 * bruit d'un téléphone à l'arrêt (accuracy 10-50m → dérive de plusieurs mètres), gonflant la
 * distance : on applique la même échelle que detectTeleportation (accuracy/10, plancher 1).
 */
export function computeFilteredDistance(
  positions: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  }>,
): number {
  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const p1 = positions[i - 1];
    const p2 = positions[i];
    const segDist = haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
    const avgAccuracy =
      p1.accuracy != null && p2.accuracy != null
        ? (p1.accuracy + p2.accuracy) / 2
        : (p1.accuracy ?? p2.accuracy ?? 0);
    const scale = avgAccuracy > 0 ? Math.max(1, avgAccuracy / 10) : 1;
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
