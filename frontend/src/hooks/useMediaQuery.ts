import { useState, useEffect } from 'react';

/**
 * Renvoie l'état d'une media query, réactif au redimensionnement.
 * Permet de ne MOUNTER qu'une seule variante d'UI (ex. desktop ou mobile),
 * au lieu de rendre les deux et de les cacher via CSS (économie de ressources,
 * de connexions WebSocket et de rendu).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
