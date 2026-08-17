export interface VehicleData {
  id: string;
  lat: number;
  lng: number;
  name: string;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp: string;
  status: 'moving' | 'static' | 'offline';
  eta?: string | null;
  routeDistance?: number;
  routeDuration?: number;
  confidence?: number;
  vehicleId: string;
  deliveryId?: string;
  suspect?: boolean;
}

export interface LivePositionInput {
  vehicleId: string;
  driverName?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  suspect?: boolean;
  timestamp: string;
  deliveryId?: string;
  minutesAgo?: number;
}

export interface PositionUpdateInput {
  vehicleId: string;
  driverId?: string;
  driverName?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  suspect?: boolean;
  confidence?: number;
  timestamp: string;
  deliveryId?: string;
}

export const FALLBACK_DRIVER_NAME = 'Véhicule sans chauffeur assigné';

export const OFFLINE_TIMEOUT_MIN = 15;

/**
 * Fusionne une position socket dans la Map des véhicules.
 * La clé primaire de la Map est TOUJOURS vehicleId — jamais driverId : quand
 * driverId est undefined (fix GPS sans chauffeur résolu), plusieurs véhicules
 * ne doivent pas s'écraser sur la même clé "undefined".
 */
export function mergePositionUpdate(
  prev: Map<string, VehicleData>,
  update: PositionUpdateInput,
  etaFor?: (update: PositionUpdateInput) => string | null,
): Map<string, VehicleData> {
  const next = new Map(prev);
  const key = update.vehicleId;
  const existing = next.get(key);

  if (update.suspect) {
    // P1 : un PREMIER point suspect (réveil du flux, téléportation « vitesse ») n'a
    // aucune position fiable de référence — le placer sur l'ancien `else` affichait un
    // marqueur fiable à des coordonnées fausses (« DÉPLACEMENT CONFIRMÉ »). On l'ignore
    // : le véhicule apparaîtra au prochain fix fiable.
    if (!existing) return next;
    next.set(key, {
      ...existing,
      speed: update.speed ?? undefined,
      heading: update.heading ?? undefined,
      accuracy: update.accuracy ?? undefined,
      timestamp: update.timestamp,
      suspect: true,
    });
  } else {
    next.set(key, {
      id: key,
      lat: update.latitude,
      lng: update.longitude,
      name: update.driverName || FALLBACK_DRIVER_NAME,
      speed: update.speed ?? undefined,
      heading: update.heading ?? undefined,
      accuracy: update.accuracy ?? undefined,
      vehicleId: update.vehicleId,
      deliveryId: update.deliveryId,
      confidence: update.confidence ?? (update.accuracy ? Math.max(0.1, 1 - update.accuracy / 50) : 1),
      timestamp: update.timestamp,
      status: update.speed && update.speed > 0.5 ? 'moving' : 'static',
      suspect: false,
      eta: etaFor ? etaFor(update) : undefined,
    });
  }
  return next;
}

/**
 * Bootstrap des véhicules depuis les positions REST live (avant le premier
 * update socket). N'écrase PAS une entrée déjà présente (un update socket plus
 * récent garde la priorité). Clé = vehicleId, jamais driverId.
 */
export function mergeBootstrapPositions(
  prev: Map<string, VehicleData>,
  positions: LivePositionInput[],
  etaFor?: (pos: LivePositionInput) => string | null,
): Map<string, VehicleData> {
  const next = new Map(prev);
  for (const pos of positions) {
    if (!pos.vehicleId || next.has(pos.vehicleId)) continue;
    const minutesOld = pos.minutesAgo ?? 0;
    const isOffline = minutesOld > OFFLINE_TIMEOUT_MIN;
    next.set(pos.vehicleId, {
      id: pos.vehicleId,
      lat: pos.latitude,
      lng: pos.longitude,
      name: pos.driverName || FALLBACK_DRIVER_NAME,
      speed: pos.speed ?? undefined,
      heading: pos.heading ?? undefined,
      accuracy: pos.accuracy ?? undefined,
      vehicleId: pos.vehicleId,
      deliveryId: pos.deliveryId ?? undefined,
      confidence: pos.accuracy ? Math.max(0.1, 1 - pos.accuracy / 50) : 1,
      timestamp: pos.timestamp,
      status: isOffline ? 'offline' : pos.speed && pos.speed > 0.5 ? 'moving' : 'static',
      suspect: pos.suspect ?? false,
      eta: etaFor ? etaFor(pos) : undefined,
    });
  }
  return next;
}
