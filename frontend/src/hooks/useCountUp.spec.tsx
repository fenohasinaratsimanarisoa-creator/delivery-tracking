import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCountUp } from './useCountUp';

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('reduced-motion') ? reduced : false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
}

describe('useCountUp', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  beforeEach(() => {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pose directement la valeur cible si prefers-reduced-motion', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCountUp(42));
    expect(result.current).toBe(42);
    expect(rafCallbacks).toHaveLength(0);
  });

  it('anime de la valeur initiale vers la cible', () => {
    setReducedMotion(false);
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(1000);

    const { result } = renderHook(() => useCountUp(100, { duration: 100 }));
    expect(result.current).toBe(100); // valeur initiale = cible (pas de flicker à 0)

    // À mi-parcours puis à la fin, la valeur reste bornée par la cible.
    nowSpy.mockReturnValue(1050);
    act(() => rafCallbacks.shift()?.(1050));
    expect(result.current).toBeLessThanOrEqual(100);

    nowSpy.mockReturnValue(1100);
    act(() => rafCallbacks.shift()?.(1100));
    expect(result.current).toBe(100);
  });

  it('neutralise une cible non-finie (jamais de NaN)', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCountUp(Number.NaN));
    expect(result.current).toBe(0);

    const { result: r2 } = renderHook(() => useCountUp(Infinity));
    expect(r2.current).toBe(0);
  });

  it('respecte le nombre de décimales', () => {
    setReducedMotion(false);
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValue(0);
    const { result } = renderHook(() => useCountUp(3.14159, { duration: 10, decimals: 2 }));

    nowSpy.mockReturnValue(100); // bien au-delà de la durée -> progress = 1
    act(() => rafCallbacks.shift()?.(100));
    expect(result.current).toBe(3.14);
  });
});
