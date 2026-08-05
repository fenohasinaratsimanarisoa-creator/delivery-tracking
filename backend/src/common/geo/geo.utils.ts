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
