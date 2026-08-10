import { type ReactNode } from 'react';
import { useDriverTracking } from '../../hooks/useDriverTracking';
import { TrackingContext } from '../../services/tracking/TrackingContext';
import ProximityAlert from './ProximityAlert';
import BatteryExemptionBanner from './BatteryExemptionBanner';

export default function DriverTrackingWrapper({ children }: { children: ReactNode }) {
  const status = useDriverTracking();

  return (
    <TrackingContext.Provider value={status}>
      <BatteryExemptionBanner status={status} />
      <ProximityAlert status={status} />
      {children}
    </TrackingContext.Provider>
  );
}
