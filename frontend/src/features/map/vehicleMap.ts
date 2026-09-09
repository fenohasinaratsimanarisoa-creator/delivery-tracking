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

// Sous cette vitesse (m/s ≈ 1,8 km/h), jamais un déplacement de véhicule — c'est du
// bruit GPS. Miroir de STATIONARY_SPEED_MS côté backend (common/geo/geo.utils.ts).
// Le backend ramène désormais ces valeurs à 0 à l'ingestion (audit VITESSE FANTÔME
// 2026-09-09) ; ce seuil reste une défense en profondeur côté affichage.
export const STATIONARY_SPEED_MS = 0.5;

/** true si la vitesse atteste un vrai déplacement (au-dessus du bruit). */
export function isMovingSpeed(speedMs: number | null | undefined): boolean {
  return speedMs != null && speedMs > STATIONARY_SPEED_MS;
}

/** Libellé de vitesse pour l'IU : « À l'arrêt » sous le seuil, sinon « X km/h ». */
export function formatVehicleSpeed(speedMs: number | null | undefined): string {
  if (!isMovingSpeed(speedMs)) return "À l'arrêt";
  return `${((speedMs as number) * 3.6).toFixed(1)} km/h`;
}

// Un traceur motion-triggered (voir traccar-bridge.service.ts côté backend)
// n'envoie AUCUNE position à l'arrêt — `status` figé sur 'moving' au dernier
// update reçu (mergePositionUpdate) ne se remet donc jamais à jour tout seul :
// un véhicule réellement arrêté depuis des minutes continuait d'afficher « EN
// MOUVEMENT » indéfiniment (aucun nouvel update pour le corriger). Passé ce
// délai sans nouvelle position, on ne fait plus confiance à un statut
// "moving" hérité — le badge/icône affichés doivent se dégrader tout seuls
// avec le temps qui passe, pas seulement à la prochaine donnée reçue.
export const STALE_MOVEMENT_MS = 120_000;

/**
 * Statut à AFFICHER (marqueur, badge popup, pill) — jamais `vehicle.status`
 * brut directement : ce dernier ne reflète que l'INSTANT du dernier update
 * reçu, sans tenir compte du temps écoulé depuis. Appeler avec un `now` qui
 * avance réellement (ex. un state rafraîchi par setInterval) pour que
 * l'affichage se corrige tout seul même sans nouvel événement socket.
 */
export function effectiveStatus(
  status: VehicleData['status'],
  timestamp: string | undefined,
  now: number,
): VehicleData['status'] {
  if (status === 'offline' || !timestamp) return status;
  const ageMs = now - new Date(timestamp).getTime();
  if (ageMs > OFFLINE_TIMEOUT_MIN * 60_000) return 'offline';
  if (status === 'moving' && ageMs > STALE_MOVEMENT_MS) return 'static';
  return status;
}

export interface FollowReference {
  id: string;
  lat: number;
  lng: number;
}

/**
 * Décide si la caméra doit re-centrer sur le véhicule suivi :
 * - true à la PREMIÈRE position d'un véhicule sélectionné (aucune référence,
 *   ou changement de véhicule) — c'est le saut caméra initial,
 * - true à CHAQUE changement de coordonnées suivant : suivi CONTINU (le défaut
 *   corrigé — avant, le snapshot sélectionné était figé et la carte ne
 *   recentrait qu'une seule fois, au clic),
 * - false quand les coordonnées sont identiques (pas de mouvement réel → pas
 *   de panTo inutile).
 * La désactivation du suivi par l'utilisateur (drag/zoom manuel) est gérée par
 * l'état `following` côté composant, pas ici.
 */
export function shouldFollowRecenter(
  prev: FollowReference | null,
  vehicle: { id: string; lat: number; lng: number },
): boolean {
  if (!prev || prev.id !== vehicle.id) return true;
  return prev.lat !== vehicle.lat || prev.lng !== vehicle.lng;
}

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
      status: isMovingSpeed(update.speed) ? 'moving' : 'static',
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
      status: isOffline ? 'offline' : isMovingSpeed(pos.speed) ? 'moving' : 'static',
      suspect: pos.suspect ?? false,
      eta: etaFor ? etaFor(pos) : undefined,
    });
  }
  return next;
}
