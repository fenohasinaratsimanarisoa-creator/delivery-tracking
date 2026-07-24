import { useTranslation } from 'react-i18next';
import { Navigation, WifiOff, AlertTriangle, Radio } from 'lucide-react';
import type { TrackingStatus } from '../hooks/useDriverTracking';

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  fontFamily: 'var(--font-mono)',
};

export default function TrackingStatusIndicator({ status }: { status: TrackingStatus }) {
  const { t } = useTranslation();

  if (status.geolocationDenied) {
    return (
      <div style={{
        ...containerStyle,
        background: 'var(--color-red-muted)',
        color: 'var(--color-red)',
        cursor: 'help',
      }} title={t('tracking.geolocationDeniedHint') || 'Autorisez la geolocalisation dans les parametres du navigateur'}>
        <AlertTriangle size={12} />
        GPS bloqué
      </div>
    );
  }

  if (!status.active) {
    return (
      <div style={{
        ...containerStyle,
        background: 'var(--color-surface-alt)',
        color: 'var(--color-text-tertiary)',
      }}>
        <Radio size={12} />
        En attente
      </div>
    );
  }

  if (status.poorAccuracy) {
    return (
      <div style={{
        ...containerStyle,
        background: 'var(--color-accent-muted)',
        color: 'var(--color-accent)',
      }}>
        <WifiOff size={12} />
        GPS faible
      </div>
    );
  }

  return (
    <div style={{
      ...containerStyle,
      background: 'var(--color-teal-muted)',
      color: 'var(--color-teal)',
    }}>
      <Navigation size={12} />
      {status.isStationary ? 'Arrêté' : 'En route'}
      {status.queueCount > 0 ? ` (${status.queueCount})` : ''}
    </div>
  );
}
