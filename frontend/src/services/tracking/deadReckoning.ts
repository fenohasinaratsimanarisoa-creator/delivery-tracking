export interface DeadReckoningState {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  timestamp: number;
}

export function predictPosition(
  lastState: DeadReckoningState,
  now?: number,
): { lat: number; lng: number } {
  const t = now ?? Date.now();
  const elapsedSec = Math.max(0, (t - lastState.timestamp) / 1000);
  if (elapsedSec <= 0 || lastState.speed <= 0) {
    return { lat: lastState.lat, lng: lastState.lng };
  }

  const distanceM = lastState.speed * elapsedSec;
  const headingRad = (lastState.heading * Math.PI) / 180;

  // 1 degree of latitude ≈ 111320m
  const dLat = (distanceM * Math.cos(headingRad)) / 111320;
  // 1 degree of longitude ≈ 111320 * cos(lat) m
  const dLng = (distanceM * Math.sin(headingRad)) / (111320 * Math.cos((lastState.lat * Math.PI) / 180));

  return {
    lat: lastState.lat + dLat,
    lng: lastState.lng + dLng,
  };
}

/** Plafond ABSOLU de l'extrapolation. Quelques secondes de plus qu'avant (5s)
 * pour couvrir l'attente entre deux fixes d'un traceur physique lent
 * (~15-20s en mouvement) sans laisser le marqueur figé, mais JAMAIS une durée
 * de coupure (minutes) : au-delà, le marqueur reste au dernier point réel et le
 * badge « signal perdu » prend le relais (voir vehicleMap.SIGNAL_LOST_MS). */
export const MAX_DEAD_RECKON_MS = 15_000;

export function maxDeadReckonTime(speed: number): number {
  if (speed <= 0) return 0;
  // Horizon proportionnel à la vitesse (plus on va vite, plus un fix manquant
  // crée un écart visible à combler), borné à MAX_DEAD_RECKON_MS.
  return Math.min(MAX_DEAD_RECKON_MS, Math.max(1000, speed * 2000 + 2000));
}