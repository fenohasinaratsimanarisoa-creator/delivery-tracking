import { type ReactNode } from 'react';
import { useDriverTracking } from '../../hooks/useDriverTracking';
import { TrackingContext } from '../../services/tracking/TrackingContext';

export default function DriverTrackingWrapper({ children }: { children: ReactNode }) {
  const status = useDriverTracking();

  return (
    <TrackingContext.Provider value={status}>
      {children}
    </TrackingContext.Provider>
  );
}
