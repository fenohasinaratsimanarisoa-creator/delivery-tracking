import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeLocationUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  timestamp?: number;
}

export interface NativeLocationSubscription {
  unsubscribe: () => void;
}

export interface BackgroundLocationPermissions {
  fineGranted: boolean;
  coarseGranted: boolean;
  backgroundGranted: boolean;
  notificationsGranted: boolean;
  allGranted: boolean;
  batteryOptimizationIgnored: boolean;
}

export interface BatteryOptimizationStatus {
  batteryOptimizationIgnored: boolean;
  requested?: boolean;
}

/**
 * Détection de la marque du téléphone (surcouches à gestion batterie agressive :
 * Xiaomi/MIUI, Huawei/EMUI, Oppo/ColorOS, Vivo, OnePlus…). Ces OS tuent l'app en
 * arrière-plan MÊME avec l'exemption Android accordée — il faut des réglages
 * manuels constructeur supplémentaires (démarrage automatique, verrouillage en
 * tâches récentes), documentés dans l'app.
 */
export interface DeviceOemInfo {
  /** Clé normalisée : 'xiaomi' | 'huawei' | 'honor' | 'oppo' | 'vivo' | 'oneplus' | 'realme' | 'samsung' | 'other' */
  oem: string;
  manufacturer: string;
  brand: string;
  model: string;
  os: string;
  sdkInt: number;
  /** true = surcouche agressive exigeant des réglages manuels supplémentaires. */
  aggressive: boolean;
  /** Intent deep-link vers l'écran "démarrage automatique" de la marque, si existant. */
  autostartIntent?: string;
  autostartAction?: string;
  batteryOptimizationIgnored: boolean;
}

export interface BackgroundLocationStatus {
  running: boolean;
  permissions: BackgroundLocationPermissions;
}

/** Marqueur d'interruption NON volontaire du tracking (service tué / force-stop). */
export interface TrackingInterruptionInfo {
  /** Epoch ms de l'interruption, ou null si aucune interruption depuis le dernier lancement. */
  interruptedAt: number | null;
  /** Raison normalisée : 'service_killed' | 'watchdog_detected_dead' | 'unknown'. */
  reason: string | null;
}

/** Alerte batterie critique émise par le foreground service (niveau ≤ 20 %). */
export interface BatteryCriticalEvent {
  level: number;
  latitude?: number;
  longitude?: number;
  timestamp?: number;
  accuracy?: number;
}

interface BackgroundLocationNative {
  start(): Promise<BackgroundLocationStatus>;
  stop(): Promise<BackgroundLocationStatus>;
  getStatus(): Promise<BackgroundLocationStatus>;
  requestPermissions(): Promise<BackgroundLocationStatus>;
  getBatteryOptimizationStatus(): Promise<BatteryOptimizationStatus>;
  requestBatteryOptimizationExemption(): Promise<BatteryOptimizationStatus>;
  getDeviceInfo(): Promise<DeviceOemInfo>;
  openOemBatterySettings(): Promise<{ opened: string }>;
  updateTrackingStatus(options: { status: string }): Promise<void>;
  getInterruptionInfo(): Promise<TrackingInterruptionInfo>;
  // --- Fallback HTTP natif (Option B, audit 21/08/2026) ---
  storeNativeFallbackToken(options: { token: string }): Promise<void>;
  storeNativeFallbackApiUrl(options: { apiUrl: string }): Promise<void>;
  markNativeJsAck(): Promise<void>;
  setNativeTrackingContext(options: { vehicleId: string; deliveryId: string }): Promise<void>;
  // --- Pont du token d'auth vers le worker natif (Phase 3, PositionUploadWorker) ---
  setAuthToken(options: { accessToken: string; expiresAtEpochMs: number }): Promise<void>;
  // --- Flush explicite du CookieManager (fix déconnexion forcée après kill process) ---
  flushCookies(): Promise<void>;
  addListener(
    eventName: 'locationUpdate' | 'batteryCritical',
    listenerFunc: (data: NativeLocationUpdate | BatteryCriticalEvent) => void,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

const GRANTED_DEFAULTS: BackgroundLocationStatus = {
  running: false,
  permissions: {
    fineGranted: true,
    coarseGranted: true,
    backgroundGranted: true,
    notificationsGranted: true,
    allGranted: true,
    batteryOptimizationIgnored: true,
  },
};

let plugin: BackgroundLocationNative | null = null;

function resolvePlugin(): BackgroundLocationNative | null {
  if (plugin) return plugin;
  if (Capacitor.getPlatform() !== 'android') return null;
  try {
    plugin = registerPlugin<BackgroundLocationNative>('BackgroundLocation');
  } catch {
    plugin = null;
  }
  return plugin;
}

export async function startBackgroundLocation(): Promise<BackgroundLocationStatus> {
  const p = resolvePlugin();
  if (!p) return GRANTED_DEFAULTS;
  return p.start();
}

export async function stopBackgroundLocation(): Promise<BackgroundLocationStatus> {
  const p = resolvePlugin();
  if (!p) return GRANTED_DEFAULTS;
  return p.stop();
}

export async function getBackgroundLocationStatus(): Promise<BackgroundLocationStatus> {
  const p = resolvePlugin();
  if (!p) return GRANTED_DEFAULTS;
  try {
    return await p.getStatus();
  } catch {
    return GRANTED_DEFAULTS;
  }
}

export async function requestBackgroundLocationPermissions(): Promise<BackgroundLocationStatus> {
  const p = resolvePlugin();
  if (!p) return GRANTED_DEFAULTS;
  return p.requestPermissions();
}

/** État persistant de l'exemption batterie (true = l'app ne sera pas Doze'd). */
export async function getBatteryOptimizationStatus(): Promise<BatteryOptimizationStatus> {
  const p = resolvePlugin();
  if (!p) return { batteryOptimizationIgnored: true };
  try {
    return await p.getBatteryOptimizationStatus();
  } catch {
    return { batteryOptimizationIgnored: true };
  }
}

/**
 * Ouvre l'écran système de demande d'exemption batterie (Android). No-op sur
 * iOS/web (resolvePlugin() → null, retourne ignoré=true). Le résultat réel n'est
 * connu qu'au retour du dialog (l'utilisateur peut refuser) → relire l'état via
 * getBatteryOptimizationStatus().
 */
export async function requestBatteryOptimizationExemption(): Promise<BatteryOptimizationStatus> {
  const p = resolvePlugin();
  if (!p) return { batteryOptimizationIgnored: true };
  try {
    return await p.requestBatteryOptimizationExemption();
  } catch {
    return { batteryOptimizationIgnored: true };
  }
}

/**
 * Détecte la marque du téléphone et ses réglages batterie spécifiques (Android).
 * No-op sur iOS/web : retourne un objet neutre (oem 'other', non agressif).
 */
export async function getDeviceOemInfo(): Promise<DeviceOemInfo> {
  const p = resolvePlugin();
  if (!p) {
    return {
      oem: 'other',
      manufacturer: '',
      brand: '',
      model: '',
      os: '',
      sdkInt: 0,
      aggressive: false,
      batteryOptimizationIgnored: true,
    };
  }
  try {
    return await p.getDeviceInfo();
  } catch {
    return {
      oem: 'other',
      manufacturer: '',
      brand: '',
      model: '',
      os: '',
      sdkInt: 0,
      aggressive: false,
      batteryOptimizationIgnored: true,
    };
  }
}

/**
 * Ouvre l'écran système "démarrage automatique / gestion arrière-plan" propre
 * à la marque (MIUI, EMUI, ColorOS, Vivo…), avec repli sur la page de détails
 * de l'app (Batterie → Sans restriction). No-op sur iOS/web.
 */
export async function openOemBatterySettings(): Promise<string> {
  const p = resolvePlugin();
  if (!p) return 'unsupported';
  try {
    const res = await p.openOemBatterySettings();
    return res.opened;
  } catch {
    return 'failed';
  }
}

/**
 * Met à jour le texte de statut de la notification persistante du foreground
 * service (état réel du suivi vu par le JS : actif / hors ligne avec file
 * locale / en pause). No-op sur iOS/web et si le service ne tourne pas.
 */
export async function updateNativeTrackingStatus(status: string): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.updateTrackingStatus({ status });
  } catch {
    // Non bloquant : la notification garde son texte par défaut.
  }
}

/**
 * Lit (et efface côté natif) le marqueur d'interruption NON volontaire du tracking.
 * À appeler au lancement du tracking : si un tracking actif a été interrompu (service
 * tué par le système, force-stop partiel détecté par le watchdog), le résultat est
 * signalé au backend → notification dashboard "Chauffeur X : tracking interrompu".
 */
export async function getNativeInterruptionInfo(): Promise<TrackingInterruptionInfo> {
  const p = resolvePlugin();
  if (!p) return { interruptedAt: null, reason: null };
  try {
    return await p.getInterruptionInfo();
  } catch {
    return { interruptedAt: null, reason: null };
  }
}

/**
 * S'abonne aux alertes batterie critique (niveau ≤ 20 %) émises par le foreground
 * service natif. Le JS enverra alors une dernière position + un statut au backend.
 */
export async function subscribeToNativeBatteryCritical(
  handler: (event: BatteryCriticalEvent) => void,
): Promise<NativeLocationSubscription | null> {
  const p = resolvePlugin();
  if (!p) return null;
  try {
    const handle = await p.addListener('batteryCritical', (data) => handler(data as BatteryCriticalEvent));
    return {
      unsubscribe: () => {
        try {
          void handle.remove();
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

/**
 * S'abonne aux positions acquises nativement par LocationForegroundService
 * (FusedLocationProviderClient, indépendant du cycle de vie de la WebView).
 *
 * Le plugin natif Android n'existe pas sur iOS/web : resolvePlugin() renvoie
 * null et cette fonction retourne null — le flux JS watchPosition reste donc
 * l'unique source sur ces plateformes (repli conservé).
 */
export async function subscribeToNativeLocations(
  handler: (position: NativeLocationUpdate) => void,
): Promise<NativeLocationSubscription | null> {
  const p = resolvePlugin();
  if (!p) return null;
  try {
    const handle = await p.addListener('locationUpdate', (data) => handler(data as NativeLocationUpdate));
    return {
      unsubscribe: () => {
        try {
          void handle.remove();
        } catch {}
      },
    };
  } catch {
    return null;
  }
}

// --- Fallback HTTP natif (Option B, audit 21/08/2026) ---

/**
 * Écrit le token d'accès dans SharedPreferences natif pour le fallback HTTP.
 * Appelé par le JS à chaque refresh de token.
 */
export async function storeNativeFallbackToken(token: string): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.storeNativeFallbackToken({ token });
  } catch {
    // Silencieux : le fallback natif est un filet de sécurité, pas critique.
  }
}

/**
 * Écrit l'URL de base de l'API dans SharedPreferences natif.
 * Appelé par le JS au démarrage du tracking.
 */
export async function storeNativeFallbackApiUrl(apiUrl: string): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.storeNativeFallbackApiUrl({ apiUrl });
  } catch {
    // Silencieux.
  }
}

// --- Pont du token d'authentification vers le worker natif (Phase 3) ---

/**
 * Écrit le token d'accès + son expiration dans EncryptedSharedPreferences natif
 * (NativeAuthTokenStore, JAMAIS en clair) — lu par PositionUploadWorker
 * (WorkManager, Phase 4) pour authentifier ses envois HTTP même quand le JS ne
 * tourne pas. Appelé à chaque login() ET à chaque refresh réussi
 * (services/auth/refreshToken.ts). No-op silencieux sur iOS/web (resolvePlugin()
 * → null), même pattern que le reste de ce fichier.
 */
export async function setNativeAuthToken(accessToken: string, expiresAtEpochMs: number): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.setAuthToken({ accessToken, expiresAtEpochMs });
  } catch {
    // Silencieux : PositionUploadWorker retentera avec l'ancien token/rien au
    // prochain cycle, ce n'est jamais bloquant pour l'app.
  }
}

/**
 * Force l'écriture sur disque du cookie refreshToken httpOnly (Android
 * CookieManager) — à appeler IMMÉDIATEMENT après chaque 200 de /auth/login ou
 * /auth/refresh (le Set-Cookie est déjà appliqué par le moteur WebView dès que
 * le JS voit la réponse). Corrige la déconnexion forcée après fermeture
 * complète de l'app : un flush uniquement basé sur onPause()/onStop()
 * (MainActivity) suppose que l'OS appelle ces callbacks avant de tuer le
 * process, ce qui est faux sur MIUI (balayage "Effacer tout" → SIGKILL direct,
 * sans cycle de vie). Ici le flush est synchronisé sur l'écriture réelle du
 * cookie, pas sur un proxy que l'OS peut contourner. No-op silencieux sur
 * iOS/web.
 */
export async function flushNativeCookies(): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.flushCookies();
  } catch {
    // Non bloquant : le flush onPause()/onStop() reste un filet de sécurité.
  }
}

/**
 * Notifie le service natif qu'unACK JS a été traité (le pipeline JS a reçu
 * et traité une position). Réinitialise le timer de silence JS.
 */
export async function markNativeJsAck(): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.markNativeJsAck();
  } catch {
    // Silencieux.
  }
}

/**
 * Met à jour le contexte véhicule/livraison pour le fallback natif HTTP.
 */
export async function setNativeTrackingContext(vehicleId: string, deliveryId: string): Promise<void> {
  const p = resolvePlugin();
  if (!p) return;
  try {
    await p.setNativeTrackingContext({ vehicleId, deliveryId });
  } catch {
    // Silencieux.
  }
}
