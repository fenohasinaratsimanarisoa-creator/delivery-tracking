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
  addListener(
    eventName: 'locationUpdate',
    listenerFunc: (data: NativeLocationUpdate) => void,
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
    const handle = await p.addListener('locationUpdate', (data) => handler(data));
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
