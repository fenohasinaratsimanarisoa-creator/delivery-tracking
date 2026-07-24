import { createContext, useContext } from 'react';
import type { TrackingStatus } from '../../hooks/useDriverTracking';

export const TrackingContext = createContext<TrackingStatus>({
  active: false,
  position: null,
  confidence: 1,
  poorAccuracy: false,
  isStationary: false,
  queueCount: 0,
  statusMsg: '',
  geolocationDenied: false,
  activeDeliveryId: '',
  proximityAlert: false,
  proximityDeliveryTitle: '',
  dismissProximityAlert: () => {},
});

export function useTrackingStatus() {
  return useContext(TrackingContext);
}
