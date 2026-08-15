import { type ReactNode } from 'react';
import { useDriverTracking } from '../../hooks/useDriverTracking';
import { TrackingContext } from '../../services/tracking/TrackingContext';
import ProximityAlert from './ProximityAlert';
import BatteryExemptionBanner from './BatteryExemptionBanner';
import BatterySetupGuide from './BatterySetupGuide';
import MobileUpdateBanner from './MobileUpdateBanner';

export default function DriverTrackingWrapper({ children }: { children: ReactNode }) {
  const status = useDriverTracking();

  return (
    <TrackingContext.Provider value={status}>
      {/* Guide de configuration batterie/OEM : affiché une fois au premier lancement. */}
      <BatterySetupGuide status={status} />
      {/* Bannière persistante tant que l'exemption batterie n'est pas accordée. */}
      <BatteryExemptionBanner status={status} />
      <ProximityAlert status={status} />
      {/* Détection d'app obsolète (native uniquement) — ferme la boucle « toujours à jour ». */}
      <MobileUpdateBanner />
      {children}
    </TrackingContext.Provider>
  );
}
