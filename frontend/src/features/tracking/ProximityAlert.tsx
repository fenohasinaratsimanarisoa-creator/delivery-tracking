import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bell, BellOff, ArrowRight, X,
  MapPin, AlertTriangle, Construction, Antenna, Radio, Ban, ShieldCheck,
} from 'lucide-react';
import type { TrackingStatus, DriverAlert } from '../../hooks/useDriverTracking';
import styles from './ProximityAlert.module.css';

// Couleurs issues des tokens du thème (var(--color-*)) : --color-accent, --color-orange
// et --color-red ont TOUS un équivalent dans colors.field (theme.ts : field.accent =
// #0E7490, field.orange = #C2410C, field.red = #B91C1C) et sont résolus dynamiquement
// par html[data-context="field"]. Le fallback hex n'est utilisé que si la variable n'est
// pas définie (jamais en contexte field) — il ne retombe pas sur le thème dark.
const URGENCY_CONFIG: Record<string, { border: string; bg: string }> = {
  normal: { border: 'var(--color-accent)', bg: 'var(--color-surface)' },
  high: { border: 'var(--color-orange)', bg: 'var(--color-surface)' },
  critical: { border: 'var(--color-red)', bg: 'var(--color-surface)' },
};

function alertIcon(type: string): React.ReactNode {
  switch (type) {
    case 'proximity': return <MapPin size={16} />;
    case 'cascade': return <AlertTriangle size={16} />;
    case 'geofence': return <Construction size={16} />;
    case 'poor_accuracy': return <Antenna size={16} />;
    case 'queue_full': return <Radio size={16} />;
    case 'queue_near_full': return <Radio size={16} />;
    case 'geo_denied': return <Ban size={16} />;
    case 'background_continued': return <ShieldCheck size={16} />;
    default: return <Bell size={16} />;
  }
}

function AlertBanner({ alert, status }: { alert: DriverAlert; status: TrackingStatus }) {
  const { t } = useTranslation();
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
      border: `1px solid ${colors.border}`,
      // Ombres LÉGÈRES uniquement (token --shadow-lg du thème field) : le glow rouge
      // critique (halo) est retiré — "aucun glow/halo" est une intention documentée du
      // thème field, pas seulement une préférence esthétique.
      boxShadow: 'var(--shadow-lg, 0 4px 14px rgba(15,23,42,0.08))',
      '--alert-color': colors.border,
    } as React.CSSProperties}>
      <div className={styles.alertGlowLine} />
      <div className={styles.alertHeader}>
        <div className={styles.alertTitleRow}>
          <span className={styles.alertIconChip}>
            {alertIcon(alert.type)}
          </span>
          <div className={styles.alertTitle} style={{ color: colors.border }}>
            {alert.title}
          </div>
        </div>
        <div className={styles.alertActions}>
          <button onClick={() => { soundEnabledRef.current = !soundEnabledRef.current; }}
            className={`${styles.iconBtn} ${soundEnabledRef.current ? styles.soundOn : styles.soundOff}`}
            aria-label="Son">
            {soundEnabledRef.current ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
          <button onClick={() => status.dismissAlert(alert.type, alert.deliveryId)}
            className={styles.dismissBtn}
            aria-label="Fermer">
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
            {t('proximityAlert.viewDeliveries')}
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
            {t('proximityAlert.retry')}
          </button>
        </div>
      )}
    </div>
  );
}

// Nombre maximal de bannières affichées simultanément : au-delà, on plie dans un
// badge "+N autres" pour ne jamais recouvrir tout l'écran d'un petit téléphone
// (un empilement réaliste de mauvaises précisions/proximités dépasse rarement 2-3).
const MAX_VISIBLE_ALERTS = 3;

export default function ProximityAlert({ status }: { status: TrackingStatus }) {
  const shownAlerts = status.alerts.filter((a) =>
    a.type === 'proximity' || a.type === 'cascade' || a.type === 'geofence' ||
    a.type === 'poor_accuracy' || a.type === 'queue_full' || a.type === 'queue_near_full' || a.type === 'geo_denied' ||
    a.type === 'background_continued'
  );

  if (shownAlerts.length === 0) return null;

  const visible = shownAlerts.slice(0, MAX_VISIBLE_ALERTS);
  const hiddenCount = shownAlerts.length - visible.length;

  // Un SEUL conteneur fixed : les bannières sont empilées verticalement par le flex
  // du conteneur (gap: 8px). L'ordre du DOM suffit, plus besoin de zIndex décroissant.
  return (
    <div className={styles.alertStack}>
      {visible.map((alert, i) => (
        <div key={`${alert.type}:${alert.deliveryId || ''}`} style={{ zIndex: 2000 - i }}>
          <AlertBanner alert={alert} status={status} />
        </div>
      ))}
      {hiddenCount > 0 && (
        <button type="button" className={styles.moreBadge}>
          {hiddenCount === 1
            ? `+1 autre alerte`
            : `+${hiddenCount} autres alertes`}
        </button>
      )}
    </div>
  );
}