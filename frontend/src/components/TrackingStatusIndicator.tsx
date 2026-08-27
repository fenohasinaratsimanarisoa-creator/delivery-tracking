import { useTranslation } from 'react-i18next';
import { Navigation, Signal, ShieldAlert, AlertTriangle, Radio, Cpu } from 'lucide-react';
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

  // SESSION EXPIRÉE (révoquée par le serveur, refresh échoué) : seul cas où le
  // chauffeur doit agir lui-même (se reconnecter) — jamais masqué, quel que
  // soit l'état de la position.
  if (status.sessionExpired) {
    return (
      <div className={`${styles.container} ${styles.sessionExpired}`}>
        <ShieldAlert size={12} />
        {t('trackingIndicator.sessionExpired')}
        <a href="/login" className={styles.reconnectLink}>
          {t('trackingIndicator.reconnectCta')}
        </a>
      </div>
    );
  }

  // BUG UX CORRIGÉ (audit GPS 2026-08-27) : dès qu'une position a déjà été
  // acquise une fois, "pas de réseau" / "précision faible" / "recherche GPS"
  // affichaient un badge alarmant qui clignotait à chaque coupure BRÈVE
  // (tunnel, changement d'antenne, dérive momentanée de précision) — alors
  // que le pipeline (file locale SQLite + WorkManager, vérifié 0% de perte
  // sur un test de 9h) continue de capturer et mettra à jour dès que possible.
  // C'est exactement le comportement Google Maps : le point reste affiché
  // avec le dernier état connu plutôt que de basculer sur une icône
  // d'erreur pour une coupure transitoire. Ces badges ne s'affichent donc
  // plus QUE tant qu'aucune position n'a jamais été acquise (début de
  // session) — au-delà, on retombe sur l'état "en route"/"arrêté" habituel.
  if (!status.position) {
    if (!status.networkOnline) {
      return (
        <div className={`${styles.container} ${styles.offline}`} title={t('trackingIndicator.noNetworkTitle')}>
          <Signal size={12} />
          {t('trackingIndicator.noNetwork')}
        </div>
      );
    }
    return (
      <div className={`${styles.container} ${styles.searching}`}>
        <Radio size={12} />
        {t('trackingIndicator.searching')}
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
