import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, ArrowRight, X } from 'lucide-react';
import type { TrackingStatus, DriverAlert } from '../../hooks/useDriverTracking';

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
    <div style={{
      position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
      zIndex: 2000 + (urgency === 'critical' ? 10 : urgency === 'high' ? 5 : 0),
      maxWidth: 420, width: 'calc(100% - 32px)',
      background: colors.bg,
      border: `2px solid ${colors.border}`,
      borderRadius: 'var(--radius-lg, 12px)',
      padding: '14px 18px',
      boxShadow: urgency === 'critical' ? '0 0 20px rgba(232,84,76,0.4)' : 'var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.5))',
      display: 'flex', flexDirection: 'column', gap: 10,
      animation: 'dt-fade-in-up 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: colors.border }}>
          {alert.type === 'proximity' && '📍 '}
          {alert.type === 'cascade' && '⚠️ '}
          {alert.type === 'geofence' && '🚧 '}
          {alert.type === 'poor_accuracy' && '📡 '}
          {alert.type === 'queue_full' && '📶 '}
          {alert.type === 'geo_denied' && '🚫 '}
          {alert.title}
          {urgency === 'critical' ? ' ⚠️' : ''}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => { soundEnabledRef.current = !soundEnabledRef.current; }}
            style={{ background:'none', border:'none', cursor:'pointer',
              color: soundEnabledRef.current ? 'var(--color-text-tertiary)' : 'var(--color-red)',
              padding: 4, display:'flex' }}>
            {soundEnabledRef.current ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
          <button onClick={() => status.dismissAlert(alert.type, alert.deliveryId)}
            style={{ background:'none', border:'none', cursor:'pointer',
              color: 'var(--color-text-tertiary)', padding: 4, fontSize:'0.8rem' }}>
            <X size={16} />
          </button>
        </div>
      </div>

      <p style={{ margin:0, fontSize:'0.8rem', color:'var(--color-text-secondary)', lineHeight:1.4 }}>
        {alert.message}
      </p>

      {(alert.type === 'proximity' || alert.type === 'cascade') && (
        <div style={{ display:'flex', gap: 8 }}>
          {(alert.type === 'proximity' || alert.type === 'cascade') && (
            <button onClick={() => {
              status.dismissAlert(alert.type, alert.deliveryId);
              navigate('/my-deliveries');
            }} style={{
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              padding:'8px 16px', flex: 1,
              background: colors.border,
              color: 'var(--color-bg, #0B1220)',
              border:'none', borderRadius:'var(--radius-md, 6px)',
              fontWeight: 600, fontSize:'0.8rem', cursor:'pointer',
            }}>
              <ArrowRight size={16} />
              Voir mes livraisons
            </button>
          )}
        </div>
      )}

      {alert.type === 'geo_denied' && (
        <div style={{ display:'flex', gap: 8 }}>
          <button onClick={() => {
            status.dismissAlert('geo_denied');
            // eslint-disable-next-line no-restricted-globals
            location.reload();
          }} style={{
            padding:'8px 16px', flex: 1,
            background: colors.border, color: '#fff',
            border:'none', borderRadius:'var(--radius-md, 6px)',
            fontWeight: 600, fontSize:'0.8rem', cursor:'pointer',
          }}>
            Réessayer
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
        <div key={`${alert.type}:${alert.deliveryId || ''}`} style={{ position: 'relative', zIndex: 2000 - i }}>
          <AlertBanner alert={alert} status={status} />
          <div style={{ height: i < shownAlerts.length - 1 ? 8 : 0 }} />
        </div>
      ))}
    </>
  );
}