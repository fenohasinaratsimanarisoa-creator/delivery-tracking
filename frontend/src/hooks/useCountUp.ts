import { useEffect, useState } from 'react';

/**
 * Anime un nombre de sa valeur courante vers `target` (easing cubic-out).
 *
 * Hook partagé : la même douzaine de lignes était recopiée dans ~12 pages, avec
 * des divergences subtiles (ordre des arguments, valeur initiale, arrondi).
 * Ici une seule implémentation, testée, et sûre par défaut :
 *  - `target` non-fini (KPI encore en chargement) → neutralisé, jamais d'anim vers NaN ;
 *  - `prefers-reduced-motion` ou absence de `matchMedia` (SSR/tests) → valeur posée直接.
 *
 * @param target  valeur cible
 * @param options `duration` en ms (défaut 650), `decimals` chiffres après la virgule (défaut 0)
 */
export function useCountUp(
  target: number,
  options: { duration?: number; decimals?: number } = {},
): number {
  const { duration = 650, decimals = 0 } = options;
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(safeTarget);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setValue(safeTarget);
      return;
    }

    let raf = 0;
    const start = performance.now();
    const factor = Math.pow(10, decimals);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(safeTarget * eased * factor) / factor);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safeTarget, duration, decimals]);

  return value;
}
