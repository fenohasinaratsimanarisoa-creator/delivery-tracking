import { useTranslation } from 'react-i18next';
import { Navigation, WifiOff, AlertTriangle, Radio, Cpu } from 'lucide-react';
import type { TrackingStatus } from '../hooks/useDriverTracking';
import styles from './TrackingStatusIndicator.module.css';

export default function TrackingStatusIndicator({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();

  const isPhysicalTracker = status.positionSource === 'physical_tracker';

  if (isPhysicalTracker) {
    return (
      <div className={`${styles.container} ${styles.physicalTracker}`} title={t('trackingIndicator.physicalTrackerTitle')}>
        <Cpu size={12} />
        {t('trackingIndicator.physicalTracker')}
      </div>
    );
  }

  if (status.geolocationDenied) {
    return (
      <div className={`${styles.container} ${styles.denied}`} title={t('tracking.geolocationDeniedHint') || 'Autorisez la geolocalisation dans les parametres du navigateur'}>
        <AlertTriangle size={12} />
        {t('trackingIndicator.gpsBlocked')}
      </div>
    );
  }

  if (!status.active) {
    return (
      <div className={`${styles.container} ${styles.inactive}`}>
        <Radio size={12} />
        {t('trackingIndicator.gpsPending')}
      </div>
    );
  }

  if (!status.position) {
    return (
      <div className={`${styles.container} ${styles.searching}`}>
        <Radio size={12} />
        {t('trackingIndicator.searching')}
      </div>
    );
  }

  if (status.poorAccuracy) {
    return (
      <div className={`${styles.container} ${styles.poorAccuracy}`}>
        <WifiOff size={12} />
        {t('trackingIndicator.poorAccuracy')}
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${styles.active}`}>
      <Navigation size={12} />
      {status.isStationary ? t('trackingIndicator.stationary') : t('trackingIndicator.moving')}
      {status.queueCount > 0 ? ` (${status.queueCount})` : ''}
    </div>
  );
}
