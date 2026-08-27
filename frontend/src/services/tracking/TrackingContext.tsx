import { createContext, useContext } from 'react';
import type { TrackingStatus } from '../../hooks/useDriverTracking';

export const TrackingContext = createContext<TrackingStatus>({
  active: false,
  position: null,
  positionSource: 'phone',
  confidence: 1,
  poorAccuracy: false,
  degradedAccuracyWhileMoving: 0,
  isStationary: false,
  queueCount: 0,
  socketConnected: false,
  networkOnline: true,
  sessionExpired: false,
  statusMsg: '',
  geolocationDenied: false,
  insecureContext: false,
  activeDeliveryId: '',
  alerts: [],
  dismissAlert: () => {},
  batteryOptimizationIgnored: true,
  requestBatteryExemption: () => Promise.resolve(),
  deviceOem: null,
  openOemSettings: () => Promise.resolve(),
  openOemBatterySaverSettings: () => Promise.resolve(),
});

export function useTrackingStatus() {
  return useContext(TrackingContext);
}
