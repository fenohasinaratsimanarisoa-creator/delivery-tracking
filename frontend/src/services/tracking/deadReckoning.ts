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

export function maxDeadReckonTime(speed: number): number {
  if (speed <= 0) return 0;
  // Max prediction: ~5 seconds at normal speed, less at low speed
  return Math.min(5000, Math.max(1000, speed * 2000 + 1000));
}