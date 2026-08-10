import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDriverTracking } from './useDriverTracking';
import api from '../services/api/client';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  React.createElement(QueryClientProvider, { client: queryClient }, children)
);

const socketEmits: Array<{ event: string; payload?: unknown }> = [];
const socketHandlers: Record<string, (data?: any) => void> = {};
let socketConnected = false;

vi.mock('../services/socket/socket', () => ({
  getSocket: () => ({
    get connected() { return socketConnected; },
    emit: (event: string, payload?: unknown) => { socketEmits.push({ event, payload }); },
    on: (event: string, handler: (data?: any) => void) => { socketHandlers[event] = handler; },
    off: vi.fn(),
    once: (event: string, handler: (data?: any) => void) => { socketHandlers[event] = handler; },
  }),
}));

vi.mock('../services/api/client', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock('../services/offlineQueue', () => ({
  enqueuePosition: vi.fn().mockResolvedValue(undefined),
  queueSize: vi.fn().mockResolvedValue(0),
  flushQueue: vi.fn().mockResolvedValue(undefined),
  clearQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/tracking/sensorFusion', () => ({
  sensorFusion: {
    init: vi.fn().mockResolvedValue(true),
    isStationary: vi.fn().mockReturnValue(false),
    isAvailable: vi.fn().mockReturnValue(false),
  },
  simulateStationaryFromSpeed: vi.fn().mockReturnValue(false),
}));

// Capture du handler natif LocationForegroundService : le test l'invoque directement
// pour vérifier que les positions natives déclenchent un envoi immédiat (sendPosition)
// et non plus seulement le prochain tick de l'intervalle.
const nativeLocationHandler: { current: ((pos: any) => void) | null } = { current: null };
const nativeSubscriptions: Array<{ unsubscribe: () => void }> = [];

vi.mock('../services/tracking/backgroundLocation', () => ({
  getBackgroundLocationStatus: vi.fn().mockResolvedValue({ running: false }),
  requestBackgroundLocationPermissions: vi.fn().mockResolvedValue(true),
  startBackgroundLocation: vi.fn().mockResolvedValue(true),
  stopBackgroundLocation: vi.fn().mockResolvedValue(true),
  subscribeToNativeLocations: vi.fn((handler: (pos: any) => void) => {
    nativeLocationHandler.current = handler;
    const sub = { unsubscribe: vi.fn() };
    nativeSubscriptions.push(sub);
    return Promise.resolve(sub);
  }),
}));

describe('useDriverTracking core logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    socketConnected = false;
    socketEmits.length = 0;
    nativeLocationHandler.current = null;
    nativeSubscriptions.length = 0;
    Object.keys(socketHandlers).forEach((k) => delete socketHandlers[k]);
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        geolocation: {
          watchPosition: vi.fn(),
          clearWatch: vi.fn(),
        },
        wakeLock: undefined,
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });
    queryClient.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes tracking status with default values', () => {
    const { result } = renderHook(() => useDriverTracking(), { wrapper });

    expect(result.current.active).toBe(false);
    expect(result.current.position).toBeNull();
    expect(result.current.queueCount).toBe(0);
    expect(result.current.poorAccuracy).toBe(false);
    expect(result.current.geolocationDenied).toBe(false);
    expect(result.current.activeDeliveryId).toBe('');
    expect(result.current.alerts).toEqual([]);
  });

  it('dismissAlert for proximity type sets snooze', () => {
    const { result } = renderHook(() => useDriverTracking(), { wrapper });

    act(() => {
      result.current.dismissAlert('proximity', 'delivery-1');
    });

    expect(result.current.alerts).toEqual([]);
  });

  it('dismissAlert for cascade type sets cascade snooze', () => {
    const { result } = renderHook(() => useDriverTracking(), { wrapper });

    act(() => {
      result.current.dismissAlert('cascade', 'delivery-1');
    });

    expect(result.current.alerts).toEqual([]);
  });

  it('dismiss on a physical_tracker server alert sends its escalationLevel to the backend', async () => {
    vi.useRealTimers();
    socketConnected = true;
    (api.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/drivers/profile') {
        return Promise.resolve({
          data: {
            id: 'd1', firstName: 'A', lastName: 'B',
            vehicle: { id: 'v1', brand: 'X', model: 'Y', licensePlate: 'Z', positionSource: 'physical_tracker' },
          },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const { result } = renderHook(() => useDriverTracking(), { wrapper });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); // laisse le profil se charger

    // Alerte serveur reçue pour un traceur physique, escalade niveau 2.
    act(() => {
      socketHandlers['proximityAlert']({
        type: 'proximity',
        deliveryId: 'delivery-1',
        escalationLevel: 2,
        urgency: 'critical',
        title: 'Livraison',
        message: 'Vous êtes sur place',
      });
    });

    act(() => {
      result.current.dismissAlert('proximity', 'delivery-1');
    });

    // Le snooze envoyé au backend porte bien l'escalade de l'alerte serveur (2 → 2 min).
    expect(socketEmits).toContainEqual({
      event: 'snoozeProximityAlert',
      payload: { deliveryId: 'delivery-1', escalationLevel: 2 },
    });
  });

  it('starts with no delivery active', () => {
    const { result } = renderHook(() => useDriverTracking(), { wrapper });
    expect(result.current.activeDeliveryId).toBe('');
  });

  it('recalcInterval keeps INTERVAL_FAST when moving, regardless of accuracy, and only traces degraded accuracy while moving', async () => {
    vi.useRealTimers();
    socketConnected = false;
    (api.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/drivers/profile') {
        return Promise.resolve({
          data: { id: 'd1', firstName: 'A', lastName: 'B', vehicle: { id: 'v1', brand: 'X', model: 'Y', licensePlate: 'Z', positionSource: 'phone' } },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const { result } = renderHook(() => useDriverTracking(), { wrapper });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking → watchPosition

    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const watchCb = (navigator.geolocation.watchPosition as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Véhicule EN MOUVEMENT avec une précision DÉGRADÉE (40m) : la fréquence d'envoi
    // ne doit PAS baisser (reste INTERVAL_FAST = 3000ms) mais le compteur trace le cas.
    act(() => { watchCb({ coords: { latitude: -18.8792, longitude: 47.5079, speed: 10, heading: 0, altitude: 0, accuracy: 40 } }); });
    expect(result.current.degradedAccuracyWhileMoving).toBe(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.anything(), 3000);

    // Puis avec une précision BONNE (10m) : même fréquence (3000ms), compteur inchangé.
    act(() => { watchCb({ coords: { latitude: -18.8792, longitude: 47.5079, speed: 10, heading: 0, altitude: 0, accuracy: 10 } }); });
    expect(result.current.degradedAccuracyWhileMoving).toBe(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.anything(), 3000);

    // Véhicule EN MOUVEMENT avec une précision dégradée NE doit PAS déclencher de
    // changement d'intervalle vers INTERVAL_SLOW (20000ms) — le compteur est le seul
    // effet de bord sur la précision dégradée.
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.anything(), 20000);

    setIntervalSpy.mockRestore();
  });

  it('native location (subscribeToNativeLocations) triggers an immediate sendPosition — and the throttle caps duplicate sends', async () => {
    vi.useRealTimers();
    socketConnected = true;
    (api.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/drivers/profile') {
        return Promise.resolve({
          data: { id: 'd1', firstName: 'A', lastName: 'B', vehicle: { id: 'v1', brand: 'X', model: 'Y', licensePlate: 'Z', positionSource: 'phone' } },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    renderHook(() => useDriverTracking(), { wrapper });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking → subscribeToNativeLocations

    expect(nativeLocationHandler.current).not.toBeNull();

    vi.useFakeTimers();
    // Envoi direct : l'émission updatePosition doit se produire SANS attendre le tick
    // de l'intervalle (le callback natif appelle sendPosition() après processCoords()).
    act(() => {
      nativeLocationHandler.current!({
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 10,
        heading: 0,
        altitude: 0,
        accuracy: 10,
      });
    });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);

    // Libère isSendingRef via positionSaved (comme le ferait le serveur) puis re-joue
    // une position native immédiatement : le throttle LOCATION_FASTEST_INTERVAL_MS (3s)
    // doit empêcher un second envoi dans la même fenêtre (sur-fréquence premier plan).
    act(() => { socketHandlers['positionSaved']?.(); });
    act(() => {
      nativeLocationHandler.current!({
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 11,
        heading: 0,
        altitude: 0,
        accuracy: 10,
      });
    });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);

    // Après +3s, un nouvel envoi natif est à nouveau autorisé.
    await act(async () => { vi.advanceTimersByTime(3100); });
    act(() => {
      nativeLocationHandler.current!({
        latitude: -18.8792,
        longitude: 47.5079,
        speed: 12,
        heading: 0,
        altitude: 0,
        accuracy: 10,
      });
    });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(2);

    // drainQueue est déclenché après un envoi réussi (positionSaved) → flushQueue appelé.
    const offlineQueue = await import('../services/offlineQueue');
    expect((offlineQueue.flushQueue as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('re-alerts (reminder) when the 2-min snooze expires after a dismiss at escalation 2 (phone)', async () => {
    vi.useRealTimers();
    socketConnected = false;
    (api.get as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url === '/drivers/profile') {
        return Promise.resolve({
          data: { id: 'd1', firstName: 'A', lastName: 'B', vehicle: { id: 'v1', brand: 'X', model: 'Y', licensePlate: 'Z', positionSource: 'phone' } },
        });
      }
      if (url === '/deliveries/my-deliveries') {
        return Promise.resolve({
          data: { data: [{ id: 'delivery-1', title: 'Livraison', status: 'in_progress', deliveryLat: -18.8792, deliveryLng: 47.5079 }] },
        });
      }
      return Promise.resolve({ data: { data: [] } });
    });

    const { result } = renderHook(() => useDriverTracking(), { wrapper });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); // profil + livraisons
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking → watchPosition

    vi.useFakeTimers();
    const watchCb = (navigator.geolocation.watchPosition as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const pos = { coords: { latitude: -18.8792, longitude: 47.5079, speed: 0, heading: 0, altitude: 0, accuracy: 10 } };

    // Entrée dans la zone (escalade 0).
    act(() => { watchCb(pos); });
    expect(result.current.alerts.some((a) => a.type === 'proximity')).toBe(true);

    // Escalade 1 (~8 min) puis escalade 2 (~16 min).
    await act(async () => { vi.advanceTimersByTime(8 * 60 * 1000); });
    act(() => { watchCb(pos); });
    await act(async () => { vi.advanceTimersByTime(8 * 60 * 1000); });
    act(() => { watchCb(pos); });
    expect(result.current.alerts.find((a) => a.type === 'proximity')?.escalationLevel).toBe(2);

    // Dismiss → snooze 2 min (ESCALATION_SNOOZE_MS).
    act(() => { result.current.dismissAlert('proximity', 'delivery-1'); });
    expect(result.current.alerts.filter((a) => a.type === 'proximity')).toHaveLength(0);

    // +2 min : le snooze expire → rappel (le banner/son réapparaît) — le throttle
    // fixe de 5 min ne doit pas écraser la fenêtre de snooze.
    await act(async () => { vi.advanceTimersByTime(2 * 60 * 1000 + 1000); });
    act(() => { watchCb(pos); });
    expect(result.current.alerts.filter((a) => a.type === 'proximity')).toHaveLength(1);
  });
});
