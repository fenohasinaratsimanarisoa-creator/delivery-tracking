import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    const w = window.innerWidth;
    return w < 480 ? 'mobile' : w < 768 ? 'tablet' : 'desktop';
  });

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setBp(w < 480 ? 'mobile' : w < 768 ? 'tablet' : 'desktop');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return bp;
}

export function isMobileWidth(width: number): boolean {
  return width < 480;
}

export function isTabletWidth(width: number): boolean {
  return width >= 480 && width < 768;
}
