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
