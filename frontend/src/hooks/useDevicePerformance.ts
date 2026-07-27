import { useMemo } from 'react';

interface NavigatorNetwork extends Navigator {
  connection?: { effectiveType: string };
  deviceMemory?: number;
}

export type DeviceTier = 'low' | 'medium' | 'high';

export function useDevicePerformance(): {
  tier: DeviceTier;
  maxAnimatedMarkers: number;
  enableAnimations: boolean;
} {
  return useMemo(() => {
    const connNav = navigator as NavigatorNetwork;
    const conn = connNav.connection;
    const isSlowNetwork = conn && (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g');
    const memory = connNav.deviceMemory;
    const isLowMemory = memory && memory <= 2;
    const cores = navigator.hardwareConcurrency;
    const isLowCPU = cores && cores <= 4;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const isLowEnd = isMobile || isSlowNetwork || isLowMemory || isLowCPU;

    if (isLowEnd && (isLowMemory || isSlowNetwork)) {
      return { tier: 'low', maxAnimatedMarkers: 15, enableAnimations: false };
    }
    if (isLowEnd || isMobile) {
      return { tier: 'medium', maxAnimatedMarkers: 30, enableAnimations: true };
    }
    return { tier: 'high', maxAnimatedMarkers: 100, enableAnimations: true };
  }, []);
}
