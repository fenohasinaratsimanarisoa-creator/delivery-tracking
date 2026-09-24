export interface VehicleData {
  id: string;
  /** Position à AFFICHER (ancre à l'arrêt / accrochage route côté serveur, sinon brute). */
  lat: number;
  lng: number;
  /** Coordonnées GPS BRUTES (popup « coordonnées », fiche véhicule, litiges). */
  rawLat?: number;
  rawLng?: number;
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
  /** Horodatage du dernier fix « en mouvement » — sert à l'hystérésis du statut. */
  lastMovingAt?: string;
  /** Heure de RÉCEPTION du dernier fix (serveur au chargement, navigateur en direct). */
  receivedAt?: string;
}

export interface LivePositionInput {
  vehicleId: string;
  driverName?: string;
  latitude: number;
  longitude: number;
  /** Position à afficher recalculée côté serveur (ancre à l'arrêt). Défaut : latitude/longitude. */
  displayLatitude?: number;
  displayLongitude?: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  suspect?: boolean;
  timestamp: string;
  deliveryId?: string;
  minutesAgo?: number;
  /** Heure d'enregistrement serveur du fix (`created_at`). */
  receivedAt?: string;
}

export interface PositionUpdateInput {
  vehicleId: string;
  driverId?: string;
  driverName?: string;
  latitude: number;
  longitude: number;
  /** Position à afficher recalculée côté serveur (ancre à l'arrêt). Défaut : latitude/longitude. */
  displayLatitude?: number;
  displayLongitude?: number;
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
 * Hystérésis « en mouvement → à l'arrêt » (audit 2026-09-19) : un fix isolé à vitesse
 * nulle (pas sous le bruit GPS, ralentissement) ne fait plus basculer le statut ; il
 * faut que le véhicule reste immobile plus longtemps que ce délai depuis son dernier
 * fix en mouvement. Au plus quelques secondes de retard sur un vrai arrêt.
 */
export const STATUS_STATIC_DEBOUNCE_MS = 12_000;

/**
 * Un fix plus ANCIEN que celui déjà affiché est ignoré (file Traccar, reconnexion,
 * désordre réseau : le marqueur reculait sur le point ancien). Au-delà de cet écart
 * (horloge du traceur réinitialisée), on l'accepte pour ne jamais figer un véhicule.
 */
export const STALE_UPDATE_RESET_MS = 10 * 60_000;

const EARTH_RADIUS_M = 6371000;

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// AUDIT ÉCART ~250 M 2026-09-15 : le popup/la fiche véhicule affichaient la
// position BRUTE (rawLat/rawLng) comme SEUL chiffre de coordonnées, sans dire
// que ce n'est pas forcément là où le marqueur est dessiné (ancre à l'arrêt /
// accrochage route). Un utilisateur qui compare voit un marqueur à un endroit
// et un chiffre à un autre, à ~250 m, sans explication — lu comme un bug même
// quand le marqueur, lui, est correct. Sous ce seuil, l'écart brut↔affiché est
// du bruit GPS normal (ne vaut pas la peine de doubler l'affichage) ; au-delà,
// il est assez significatif pour justifier une ligne séparée, clairement
// étiquetée « brute », en plus de la position affichée.
export const RAW_POSITION_DIVERGENCE_M = 20;

/** true si la position brute diverge assez de la position affichée pour valoir une ligne séparée. */
export function rawPositionDiverges(
  lat: number | undefined,
  lng: number | undefined,
  rawLat: number | undefined,
  rawLng: number | undefined,
): boolean {
  if (lat == null || lng == null || rawLat == null || rawLng == null) return false;
  return haversineDistanceM(lat, lng, rawLat, rawLng) > RAW_POSITION_DIVERGENCE_M;
}

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
/**
 * Écart max accepté entre l'heure du fix et sa réception pour dater la FRAÎCHEUR du
 * signal par la réception. Au-delà, le fix est un rattrapage d'historique (backfill) :
 * sa propre heure fait foi.
 */
export const CLOCK_LAG_MAX_MS = 5 * 60_000;

/**
 * Horodatage à utiliser pour l'ÂGE du signal (statut, « signal perdu », vitesse en direct).
 * Audit trajets 2026-09-21 : l'horloge interne du GT06 retarde d'environ 3 s par jour
 * (21 s → 32 s en 4 jours, remise à ~5 s au redémarrage du traceur). Dater l'âge par
 * l'heure du fix aurait fini par afficher « signal perdu » (> 60 s) en permanence, même
 * en roulant. L'heure de réception ne dépend pas de l'horloge du traceur. L'heure du fix
 * reste celle AFFICHÉE et stockée.
 */
export function freshnessTimestamp(v: { timestamp?: string; receivedAt?: string }): string | undefined {
  if (!v.receivedAt || !v.timestamp) return v.timestamp;
  const lag = Date.parse(v.receivedAt) - Date.parse(v.timestamp);
  if (!Number.isFinite(lag) || lag < 0 || lag > CLOCK_LAG_MAX_MS) return v.timestamp;
  return v.receivedAt;
}

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

/**
 * Un véhicule suivi qui n'a plus rien émis depuis ce délai : signal probablement
 * perdu (réseau GPRS coupé, boîtier en veille, tunnel…). Le marqueur affiché est
 * alors PÉRIMÉ — il ne bouge plus alors que le véhicule roule peut-être encore.
 * Plus court que STALE_MOVEMENT_MS (bascule d'icône « moving » → « static ») et
 * que OFFLINE_TIMEOUT_MIN (bascule « hors ligne ») : c'est un avertissement
 * précoce, purement visuel (badge + marqueur atténué), sans changer le statut.
 * Calibré sur la cadence d'un traceur physique en mouvement (~15-20s) + marge.
 */
export const SIGNAL_LOST_MS = 60_000;

/**
 * Depuis combien de temps (ms) le signal est perdu, ou `null` si le signal est
 * frais (< SIGNAL_LOST_MS) ou si le véhicule est déjà « hors ligne »
 * (> OFFLINE_TIMEOUT_MIN, badge dédié). Appeler avec un `now` qui avance
 * réellement pour que l'avertissement apparaisse/disparaisse tout seul.
 */
export function signalLostSinceMs(
  timestamp: string | undefined,
  now: number,
): number | null {
  if (!timestamp) return null;
  const age = now - new Date(timestamp).getTime();
  if (age <= SIGNAL_LOST_MS) return null;
  if (age > OFFLINE_TIMEOUT_MIN * 60_000) return null;
  return age;
}

/**
 * Libellé de vitesse à afficher EN DIRECT (popup, fiche véhicule) : « À l'arrêt »
 * dès que le véhicule n'est pas ACTIVEMENT en mouvement — arrêté, signal périmé
 * ou hors ligne. Une vitesse « en direct » sur un véhicule dont la dernière
 * position remonte à des heures (traceur motion-triggered endormi) est la valeur
 * FIGÉE de son dernier fix : l'afficher laisse croire qu'il roule encore.
 * Ne remplace pas les vues historiques (rapport de trajet, relecture).
 */
export function liveSpeedLabel(
  speedMs: number | null | undefined,
  status: VehicleData['status'],
  timestamp: string | undefined,
  now: number,
): string {
  if (effectiveStatus(status, timestamp, now) !== 'moving') return "À l'arrêt";
  return formatVehicleSpeed(speedMs);
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
  const key = update.vehicleId;
  const existingForOrder = prev.get(key);
  if (existingForOrder) {
    const dt = Date.parse(update.timestamp) - Date.parse(existingForOrder.timestamp);
    if (Number.isFinite(dt) && dt < 0 && dt > -STALE_UPDATE_RESET_MS) return prev;
  }
  const next = new Map(prev);
  const existing = next.get(key);

  if (update.suspect) {
    // P1 : un PREMIER point suspect (réveil du flux, téléportation « vitesse ») n'a
    // aucune position fiable de référence — le placer sur l'ancien `else` affichait un
    // marqueur fiable à des coordonnées fausses (« DÉPLACEMENT CONFIRMÉ »). On l'ignore
    // : le véhicule apparaîtra au prochain fix fiable.
    if (!existing) return next;
    next.set(key, {
      ...existing,
      // Position affichée INCHANGÉE (le point suspect ne bouge pas le marqueur),
      // mais on rafraîchit les coordonnées BRUTES : c'est là qu'a atterri le fix.
      rawLat: update.latitude,
      rawLng: update.longitude,
      speed: update.speed ?? undefined,
      heading: update.heading ?? undefined,
      accuracy: update.accuracy ?? undefined,
      timestamp: update.timestamp,
      receivedAt: new Date().toISOString(),
      suspect: true,
    });
  } else {
    const movingNow = isMovingSpeed(update.speed);
    const lastMovingAt = movingNow ? update.timestamp : existing?.lastMovingAt;
    let nextStatus: VehicleData['status'] = movingNow ? 'moving' : 'static';
    if (!movingNow && existing?.status === 'moving' && existing.lastMovingAt) {
      const sinceMoving = Date.parse(update.timestamp) - Date.parse(existing.lastMovingAt);
      if (Number.isFinite(sinceMoving) && sinceMoving < STATUS_STATIC_DEBOUNCE_MS) {
        nextStatus = 'moving';
      }
    }
    next.set(key, {
      id: key,
      lat: update.displayLatitude ?? update.latitude,
      lng: update.displayLongitude ?? update.longitude,
      rawLat: update.latitude,
      rawLng: update.longitude,
      name: update.driverName || FALLBACK_DRIVER_NAME,
      speed: update.speed ?? undefined,
      heading: update.heading ?? undefined,
      accuracy: update.accuracy ?? undefined,
      vehicleId: update.vehicleId,
      deliveryId: update.deliveryId,
      confidence: update.confidence ?? (update.accuracy ? Math.max(0.1, 1 - update.accuracy / 50) : 1),
      timestamp: update.timestamp,
      receivedAt: new Date().toISOString(),
      status: nextStatus,
      lastMovingAt,
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
      lat: pos.displayLatitude ?? pos.latitude,
      lng: pos.displayLongitude ?? pos.longitude,
      rawLat: pos.latitude,
      rawLng: pos.longitude,
      name: pos.driverName || FALLBACK_DRIVER_NAME,
      speed: pos.speed ?? undefined,
      heading: pos.heading ?? undefined,
      accuracy: pos.accuracy ?? undefined,
      vehicleId: pos.vehicleId,
      deliveryId: pos.deliveryId ?? undefined,
      confidence: pos.accuracy ? Math.max(0.1, 1 - pos.accuracy / 50) : 1,
      timestamp: pos.timestamp,
      receivedAt: pos.receivedAt,
      status: isOffline ? 'offline' : isMovingSpeed(pos.speed) ? 'moving' : 'static',
      suspect: pos.suspect ?? false,
      eta: etaFor ? etaFor(pos) : undefined,
    });
  }
  return next;
}
