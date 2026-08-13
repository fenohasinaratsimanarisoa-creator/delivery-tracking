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
// Epoch ms (horloge fake) de CHAQUE émission réelle d'updatePosition : sert au
// test de cadence à produire le log des timestamps consécutifs reçus côté carte.
const emittedAt: number[] = [];
const socketHandlers: Record<string, (data?: any) => void> = {};
let socketConnected = false;

// Fausse file IndexedDB observable : les tests B/C vérifient qu'aucune position
// n'est perdue via queueSize() (positions mise en file pendant un envoi en cours).
const { fakeQueue } = vi.hoisted(() => ({ fakeQueue: [] as unknown[] }));

vi.mock('../services/socket/socket', () => ({
  getSocket: () => ({
    get connected() { return socketConnected; },
    emit: (event: string, payload?: unknown) => {
      socketEmits.push({ event, payload });
      if (event === 'updatePosition') emittedAt.push(Date.now());
    },
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
  enqueuePosition: vi.fn(async (pos: unknown) => { fakeQueue.push(pos); }),
  queueSize: vi.fn(async () => fakeQueue.length),
  flushQueue: vi.fn(async () => { fakeQueue.length = 0; }),
  clearQueue: vi.fn(async () => { fakeQueue.length = 0; }),
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
  getBatteryOptimizationStatus: vi.fn().mockResolvedValue({ batteryOptimizationIgnored: true }),
  requestBatteryOptimizationExemption: vi.fn().mockResolvedValue({ batteryOptimizationIgnored: true }),
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
    vi.clearAllMocks(); // réinitialise les compteurs d'appels (implémentations conservées)
    socketConnected = false;
    socketEmits.length = 0;
    emittedAt.length = 0;
    fakeQueue.length = 0;
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

  it('Test B : un ACK positionSaved reçu < 500ms libère isSendingRef sans attendre le timeout', async () => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking

    vi.useFakeTimers();
    const nativeHandler = nativeLocationHandler.current!;

    // Envoi n°1 (t=0) : emit updatePosition, isSendingRef=true.
    act(() => {
      nativeHandler({ latitude: -18.8792, longitude: 47.5079, speed: 10, heading: 0, altitude: 0, accuracy: 10 });
    });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);

    // ACK réel du serveur (positionSaved explicite) reçu 100ms après l'emit —
    // bien avant le filet de sécurité de 2000ms : isSendingRef doit être libéré
    // par l'ACK, PAS par le timeout.
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { socketHandlers['positionSaved']?.({ id: 'pos-1', suspect: false }); });

    // Saut de Date.now() au-delà du throttle (3s) SANS laisser tourner les timers :
    // si isSendingRef avait seulement été libéré par le timeout (2000ms), il serait
    // ENCORE true à cet instant → la position serait mise en file au lieu d'être
    // émise. Seul l'ACK précoce rend ce second envoi direct possible.
    act(() => { vi.setSystemTime(new Date(Date.now() + 3100)); });
    act(() => {
      nativeHandler({ latitude: -18.8793, longitude: 47.508, speed: 11, heading: 0, altitude: 0, accuracy: 10 });
    });

    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(2);
    const offlineQueue = await import('../services/offlineQueue');
    expect(offlineQueue.enqueuePosition).not.toHaveBeenCalled();
  });

  it('Test C : rafale de 3 positions natives pendant un envoi en cours → AUCUNE perdue (toutes en file, purgées au drain)', async () => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking

    vi.useFakeTimers();
    const nativeHandler = nativeLocationHandler.current!;
    const posAt = (i: number) => ({ latitude: -18.8792 + i * 0.0001, longitude: 47.5079 + i * 0.0001, speed: 12, heading: 0, altitude: 0, accuracy: 10 });

    // t=0 : envoi direct (isSendingRef=true, ACK jamais émis dans ce scénario).
    act(() => { nativeHandler(posAt(0)); });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);

    // Rafale : 3 positions natives à moins de 200ms d'écart pendant l'envoi en cours.
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { nativeHandler(posAt(1)); });
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { nativeHandler(posAt(2)); });
    act(() => { vi.advanceTimersByTime(50); });
    act(() => { nativeHandler(posAt(3)); });

    // AUCUNE des 3 positions de la rafale n'est perdue : toutes mises en file locale
    // (le return silencieux d'avant les jeterait — sous-comptage de distance).
    const offlineQueue = await import('../services/offlineQueue');
    expect(await offlineQueue.queueSize()).toBe(3);
    expect(offlineQueue.enqueuePosition).toHaveBeenCalledTimes(3);

    // Le drain (déclenché par le hook sur l'événement 'connect' du socket, comme au
    // retour réseau) vide la file via batchPosition → flushQueue : les positions
    // sont récupérées, pas abandonnées.
    act(() => { socketHandlers['connect']?.(); });
    await act(async () => {}); // microtasks (drainQueue async → flushQueue → queueSize)
    expect(offlineQueue.flushQueue).toHaveBeenCalled();
    expect(await offlineQueue.queueSize()).toBe(0);
  });

  it('Test D : position pendant la fenêtre de throttle (LOCATION_FASTEST_INTERVAL_MS) → mise en file, PAS perdue', async () => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking

    // vi.useFakeTimers simule Date.now() : l'horloge fake est l'unique source de
    // temps pour le garde de throttle (nowTs - lastSendTimeRef.current).
    vi.useFakeTimers();
    const nativeHandler = nativeLocationHandler.current!;

    // t=0 : processCoords() puis sendPosition() n°1 → envoi direct émis.
    act(() => {
      nativeHandler({ latitude: -18.8792, longitude: 47.5079, speed: 12, heading: 0, altitude: 0, accuracy: 10 });
    });
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);

    // ACK serveur : isSendingRef libéré, mais lastSendTimeRef garde la trace du
    // tout dernier envoi (t=0).
    act(() => { socketHandlers['positionSaved']?.({ id: 'pos-1', suspect: false }); });

    // t+500ms (bien SOUS LOCATION_FASTEST_INTERVAL_MS=2000ms) : second
    // processCoords() puis sendPosition() → le garde de throttle (isSendingRef
    // libre, fenêtre non écoulée) doit METTRE EN FILE la position, pas la
    // perdre silencieusement.
    act(() => { vi.advanceTimersByTime(500); });
    act(() => {
      nativeHandler({ latitude: -18.8793, longitude: 47.508, speed: 12, heading: 0, altitude: 0, accuracy: 10 });
    });

    // Le throttle est préservé : aucun second emit direct dans la fenêtre.
    expect(socketEmits.filter((e) => e.event === 'updatePosition')).toHaveLength(1);
    // Mais la DEUXIÈME position n'est PAS silencieusement perdue : elle est dans
    // la file IndexedDB (retentée par drainQueue).
    const offlineQueue = await import('../services/offlineQueue');
    expect(await offlineQueue.queueSize()).toBe(1);
    expect(offlineQueue.enqueuePosition).toHaveBeenCalledTimes(1);

    // Après la fenêtre de throttle, la position en file est purgée par un drain
    // (ex. retour du réseau) : elle part bien au backend.
    act(() => { socketHandlers['connect']?.(); });
    await act(async () => {});
    expect(offlineQueue.flushQueue).toHaveBeenCalled();
    expect(await offlineQueue.queueSize()).toBe(0);
  });

  it('Test cadence : 5 min simulées de positions natives (2s) → intervalle moyen entre positions émises ≤ 3s', async () => {
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
    await act(async () => { await new Promise((r) => setTimeout(r, 1600)); }); // startTracking

    vi.useFakeTimers();
    const nativeHandler = nativeLocationHandler.current!;

    // 150 positions natives à 2s d'intervalle = 5 minutes. Cadence « favorisée »
    // par le foreground service (LOCATION_FASTEST_INTERVAL_MS = 2000L) quand le
    // système remonte des fixes plus souvent : le nouveau throttle JS (2000ms)
    // laisse passer le flux (l'ancien 3000ms l'étranglait à 3s).
    for (let i = 0; i < 150; i++) {
      act(() => {
        nativeHandler({ latitude: -18.8792 + i * 0.0001, longitude: 47.5079 + i * 0.0001, speed: 12, heading: 0, altitude: 0, accuracy: 10 });
      });
      // ACK serveur rapide : libère isSendingRef (l'ACK réel, pas le filet 2000ms).
      act(() => { socketHandlers['positionSaved']?.({ id: `pos-${i}`, suspect: false }); });
      act(() => { vi.advanceTimersByTime(2000); });
    }

    // emittedAt = epoch ms (horloge fake) de chaque updatePosition réellement émis
    // (callback natif direct + tick de l'intervalle), c'est-à-dire les instants où
    // la position apparaît côté serveur/carte pendant la fenêtre de 5 minutes.
    const intervals: number[] = [];
    for (let i = 1; i < emittedAt.length; i++) {
      intervals.push(emittedAt[i] - emittedAt[i - 1]);
    }
    const meanInterval = intervals.length > 0
      ? intervals.reduce((a, b) => a + b, 0) / intervals.length
      : Infinity;

    // LOG RÉEL DES TIMESTAMPS (preuve exigée : log, pas une affirmation).
    // eslint-disable-next-line no-console
    console.log(
      `[test cadence] positions émises=${emittedAt.length}/150 sur 300s simulées — `
      + `intervalle moyen=${meanInterval.toFixed(0)}ms — `
      + `premiers ts: ${emittedAt.slice(0, 3).join(', ')} — `
      + `derniers ts: ${emittedAt.slice(-3).join(', ')}`,
    );

    // Au moins 110 des 150 positions partent en temps réel (le reste, coincé par
    // le throttle pendant le conflit tick/natif, part via drainQueue en batch).
    expect(emittedAt.length).toBeGreaterThanOrEqual(110);
    // Intervalle moyen entre deux points émis ≤ 3s (exigence du test obligatoire).
    expect(meanInterval).toBeLessThanOrEqual(3000);
  });
});
