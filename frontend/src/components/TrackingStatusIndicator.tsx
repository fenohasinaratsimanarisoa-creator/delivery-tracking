import { useTranslation } from 'react-i18next';
import { Navigation, WifiOff, AlertTriangle, Radio, Cpu } from 'lucide-react';
import type { TrackingStatus } from '../hooks/useDriverTracking';
import styles from './TrackingStatusIndicator.module.css';

export default function TrackingStatusIndicator({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();

  const isPhysicalTracker = status.positionSource === 'physical_tracker';

  if (isPhysicalTracker) {
    return (
      <div className={`${styles.container} ${styles.physicalTracker}`} title="Suivi par traceur GPS physique installé sur le véhicule">
        <Cpu size={12} />
        Traceur GPS
      </div>
    );
  }

  if (status.geolocationDenied) {
    return (
      <div className={`${styles.container} ${styles.denied}`} title={t('tracking.geolocationDeniedHint') || 'Autorisez la geolocalisation dans les parametres du navigateur'}>
        <AlertTriangle size={12} />
        GPS bloqué
      </div>
    );
  }

  if (!status.active) {
    return (
      <div className={`${styles.container} ${styles.inactive}`}>
        <Radio size={12} />
        GPS en attente
      </div>
    );
  }

  if (!status.position) {
    return (
      <div className={`${styles.container} ${styles.searching}`}>
        <Radio size={12} />
        Recherche signal...
      </div>
    );
  }

  if (status.poorAccuracy) {
    return (
      <div className={`${styles.container} ${styles.poorAccuracy}`}>
        <WifiOff size={12} />
        GPS faible
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${styles.active}`}>
      <Navigation size={12} />
      {status.isStationary ? 'Arrêté' : 'En route'}
      {status.queueCount > 0 ? ` (${status.queueCount})` : ''}
    </div>
  );
}
