import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetServiceWorkerAndReload } from './reset';

// Mocks
const mockReload = vi.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: mockReload },
  writable: true,
});

const mockGetRegistrations = vi.fn();
const mockUnregister = vi.fn();
const mockCacheKeys = vi.fn();
const mockCacheDelete = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();

  // Mock serviceWorker
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistrations: mockGetRegistrations,
    },
    writable: true,
    configurable: true,
  });

  // Mock caches
  Object.defineProperty(window, 'caches', {
    value: {
      keys: mockCacheKeys,
      delete: mockCacheDelete,
    },
    writable: true,
    configurable: true,
  });

  mockGetRegistrations.mockResolvedValue([
    { unregister: mockUnregister.mockResolvedValue(true) },
    { unregister: mockUnregister.mockResolvedValue(true) },
  ]);
  mockCacheKeys.mockResolvedValue(['logitrack-v3', 'logitrack-v4']);
  mockCacheDelete.mockResolvedValue(true);
});

describe('resetServiceWorkerAndReload', () => {
  it('désenregistre tous les service workers', async () => {
    await resetServiceWorkerAndReload();
    expect(mockGetRegistrations).toHaveBeenCalledTimes(1);
    expect(mockUnregister).toHaveBeenCalledTimes(2);
  });

  it('purge tous les caches', async () => {
    await resetServiceWorkerAndReload();
    expect(mockCacheKeys).toHaveBeenCalledTimes(1);
    expect(mockCacheDelete).toHaveBeenCalledWith('logitrack-v3');
    expect(mockCacheDelete).toHaveBeenCalledWith('logitrack-v4');
  });

  it('pose dt_chunk_reload dans sessionStorage avec un horodatage', async () => {
    const before = Date.now();
    await resetServiceWorkerAndReload();
    const after = Date.now();
    const stored = Number(sessionStorage.getItem('dt_chunk_reload'));
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(after);
  });

  it('appelle window.location.reload()', async () => {
    await resetServiceWorkerAndReload();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('gère les erreurs de getRegistrations sans planter', async () => {
    mockGetRegistrations.mockRejectedValue(new Error('SW unavailable'));
    await expect(resetServiceWorkerAndReload()).resolves.not.toThrow();
    // Le reload est quand même appelé
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('gère les erreurs de caches.keys sans planter', async () => {
    mockCacheKeys.mockRejectedValue(new Error('Cache API unavailable'));
    await expect(resetServiceWorkerAndReload()).resolves.not.toThrow();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('fonctionne même si navigator.serviceWorker n\'existe pas', async () => {
    // Simuler un navigateur sans serviceWorker
    Object.defineProperty(navigator, 'serviceWorker', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    await expect(resetServiceWorkerAndReload()).resolves.not.toThrow();
    expect(mockCacheKeys).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('fonctionne même si caches n\'existe pas', async () => {
    Object.defineProperty(window, 'caches', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    await expect(resetServiceWorkerAndReload()).resolves.not.toThrow();
    expect(mockGetRegistrations).toHaveBeenCalledTimes(1);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('unregistrations partielles (certains échouent) ne bloque pas', async () => {
    mockGetRegistrations.mockResolvedValue([
      { unregister: mockUnregister.mockResolvedValue(true) },
      { unregister: mockUnregister.mockRejectedValue(new Error('fail')) },
      { unregister: mockUnregister.mockResolvedValue(true) },
    ]);
    await expect(resetServiceWorkerAndReload()).resolves.not.toThrow();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
