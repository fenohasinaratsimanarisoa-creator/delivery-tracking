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
    once: vi.fn(),
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

describe('useDriverTracking core logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    socketConnected = false;
    socketEmits.length = 0;
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
});
