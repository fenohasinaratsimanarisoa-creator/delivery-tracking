import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, ArrowRight, X } from 'lucide-react';
import type { TrackingStatus, DriverAlert } from '../../hooks/useDriverTracking';
import styles from './ProximityAlert.module.css';

const URGENCY_CONFIG = {
  normal: { border: 'var(--color-accent, #F2A93C)', bg: 'var(--color-surface, #121B2E)' },
  high: { border: 'var(--color-orange, #E8753C)', bg: 'var(--color-surface, #1A1525)' },
  critical: { border: 'var(--color-red, #E8544C)', bg: 'var(--color-surface, #201015)' },
};

function AlertBanner({ alert, status }: { alert: DriverAlert; status: TrackingStatus }) {
  const navigate = useNavigate();
  const soundEnabledRef = useRef(true);
  const audioPlayedRef = useRef(false);
  const urgency = alert.urgency || 'normal';
  const colors = URGENCY_CONFIG[urgency];

  useEffect(() => {
    if (audioPlayedRef.current) return;
    try {
      const audio = new Audio('data:audio/wav;base64,' +
        'UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAf39/f4B/f3' +
        '+Af39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/AAD/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f');
      audio.volume = urgency === 'critical' ? 0.8 : 0.5;
      audio.play().then(() => { audioPlayedRef.current = true; }).catch(() => {});
    } catch {}
  }, [alert.type]);

  return (
    <div className={styles.alertBanner} style={{
      zIndex: 2000 + (urgency === 'critical' ? 10 : urgency === 'high' ? 5 : 0),
      background: colors.bg,
      border: `2px solid ${colors.border}`,
      boxShadow: urgency === 'critical' ? '0 0 20px rgba(232,84,76,0.4)' : 'var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.5))',
    }}>
      <div className={styles.alertHeader}>
        <div className={styles.alertTitle} style={{ color: colors.border }}>
          {alert.type === 'proximity' && '📍 '}
          {alert.type === 'cascade' && '⚠️ '}
          {alert.type === 'geofence' && '🚧 '}
          {alert.type === 'poor_accuracy' && '📡 '}
          {alert.type === 'queue_full' && '📶 '}
          {alert.type === 'geo_denied' && '🚫 '}
          {alert.title}
          {urgency === 'critical' ? ' ⚠️' : ''}
        </div>
        <div className={styles.alertActions}>
          <button onClick={() => { soundEnabledRef.current = !soundEnabledRef.current; }}
            className={`${styles.iconBtn} ${soundEnabledRef.current ? styles.soundOn : styles.soundOff}`}>
            {soundEnabledRef.current ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
          <button onClick={() => status.dismissAlert(alert.type, alert.deliveryId)}
            className={styles.dismissBtn}>
            <X size={16} />
          </button>
        </div>
      </div>

      <p className={styles.alertMessage}>
        {alert.message}
      </p>

      {(alert.type === 'proximity' || alert.type === 'cascade') && (
        <div className={styles.alertActionsRow}>
          <button onClick={() => {
            status.dismissAlert(alert.type, alert.deliveryId);
            navigate('/my-deliveries');
          }} className={styles.actionBtn} style={{ background: colors.border }}>
            <ArrowRight size={16} />
            {'Voir mes livraisons'}
          </button>
        </div>
      )}

      {alert.type === 'geo_denied' && (
        <div className={styles.alertActionsRow}>
          <button onClick={() => {
            status.dismissAlert('geo_denied');
            // eslint-disable-next-line no-restricted-globals
            location.reload();
          }} className={`${styles.actionBtn} ${styles.actionBtnLight}`} style={{ background: colors.border }}>
            {'Réessayer'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProximityAlert({ status }: { status: TrackingStatus }) {
  const shownAlerts = status.alerts.filter((a) =>
    a.type === 'proximity' || a.type === 'cascade' || a.type === 'geofence' ||
    a.type === 'poor_accuracy' || a.type === 'queue_full' || a.type === 'geo_denied'
  );

  if (shownAlerts.length === 0) return null;

  return (
    <>
      {shownAlerts.map((alert, i) => (
        <div key={`${alert.type}:${alert.deliveryId || ''}`} className={styles.alertWrapper} style={{ zIndex: 2000 - i }}>
          <AlertBanner alert={alert} status={status} />
          <div className={styles.alertSpacer} style={{ height: i < shownAlerts.length - 1 ? 8 : 0 }} />
        </div>
      ))}
    </>
  );
}