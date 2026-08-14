import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

function installMatchMedia(initial: boolean) {
  const listeners = new Set<(e?: unknown) => void>();
  let matches = initial;
  const mql = {
    get matches() {
      return matches;
    },
    media: '(max-width: 768px)',
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    addListener: (_cb: () => void) => {},
    removeListener: (_cb: () => void) => {},
    onchange: null,
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn(() => mql),
  });
  return {
    set(m: boolean) {
      matches = m;
      listeners.forEach((cb) => cb(mql));
    },
    get listeners() {
      return listeners;
    },
  };
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('retourne l\'état initial du breakpoint', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(result.current).toBe(false);
  });

  it('réagit au changement de breakpoint (ne monter qu\'un seul RealTimeMap)', () => {
    const mq = installMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(result.current).toBe(false);

    act(() => mq.set(true));
    expect(result.current).toBe(true);

    act(() => mq.set(false));
    expect(result.current).toBe(false);
  });

  it('nettote le listener au démontage', () => {
    const mq = installMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'));
    expect(mq.listeners.size).toBe(1);
    unmount();
    expect(mq.listeners.size).toBe(0);
  });
});
