import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isChunkLoadError, recoverFromChunkLoadError } from './chunkRecovery';

vi.mock('./reset', () => ({
  resetServiceWorkerAndReload: vi.fn(),
}));

import { resetServiceWorkerAndReload } from './reset';

const mockReload = vi.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: mockReload },
  writable: true,
});

describe('isChunkLoadError', () => {
  it('reconnaît les messages Chrome/Vite d\'import() dynamique en échec', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module: https://x/AlertsPage-abc.js')).toBe(true);
  });

  it('reconnaît les messages Firefox', () => {
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true);
  });

  it('reconnaît un échec de script module', () => {
    expect(isChunkLoadError('Failed to load module script: server responded with 404')).toBe(true);
  });

  it('reconnaît le message Safari', () => {
    expect(isChunkLoadError('Importing a module script failed')).toBe(true);
  });

  it('ignore un message applicatif sans rapport', () => {
    expect(isChunkLoadError('Cannot read properties of undefined')).toBe(false);
  });

  it('gère undefined/null sans planter', () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('recoverFromChunkLoadError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('1er échec : simple reload, horodaté', () => {
    const before = Date.now();
    recoverFromChunkLoadError('chunk introuvable (test)');
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(resetServiceWorkerAndReload).not.toHaveBeenCalled();
    expect(Number(sessionStorage.getItem('dt_chunk_reload'))).toBeGreaterThanOrEqual(before);
  });

  it('échec persistant peu après un reload récent : reset complet du SW, pas de 2e reload', () => {
    sessionStorage.setItem('dt_chunk_reload', String(Date.now() - 1000)); // reload il y a 1s (< cooldown 10s)
    recoverFromChunkLoadError('chunk introuvable (test)');
    expect(mockReload).not.toHaveBeenCalled();
    expect(resetServiceWorkerAndReload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('dt_sw_reset')).not.toBeNull();
  });

  it('3e échec (reload ET reset SW déjà tentés récemment) : abandonne sans boucler', () => {
    sessionStorage.setItem('dt_chunk_reload', String(Date.now() - 1000));
    sessionStorage.setItem('dt_sw_reset', String(Date.now() - 1000));
    recoverFromChunkLoadError('chunk introuvable (test)');
    expect(mockReload).not.toHaveBeenCalled();
    expect(resetServiceWorkerAndReload).not.toHaveBeenCalled();
  });

  it('hors-ligne : ne recharge pas et ne touche pas au service worker (mode offline préservé)', () => {
    sessionStorage.setItem('dt_chunk_reload', String(Date.now() - 1000));
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    recoverFromChunkLoadError('chunk introuvable (test)');
    expect(mockReload).not.toHaveBeenCalled();
    expect(resetServiceWorkerAndReload).not.toHaveBeenCalled();
  });
});
