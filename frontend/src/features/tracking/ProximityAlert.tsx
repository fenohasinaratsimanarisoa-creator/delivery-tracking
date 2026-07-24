import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, ArrowRight } from 'lucide-react';
import type { TrackingStatus } from '../../hooks/useDriverTracking';

export default function ProximityAlert({ status }: { status: TrackingStatus }) {
  const navigate = useNavigate();
  const soundEnabledRef = useRef(true);
  const audioPlayedRef = useRef(false);

  useEffect(() => {
    if (!status.proximityAlert) {
      audioPlayedRef.current = false;
      return;
    }

    if (!soundEnabledRef.current || audioPlayedRef.current) return;

    try {
      const audio = new Audio('data:audio/wav;base64,' +
        'UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAf39/f4B/f3' +
        '+Af39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f39/fn5+f3' +
        '9/fn5+f39/fn5+fn5+f39/fn5+f39/fn5+f39/fn5+f39/AAD/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f/5//n/+f' +
        '');
      audio.volume = 0.5;
      audio.play().then(() => {
        audioPlayedRef.current = true;
      }).catch(() => {});
    } catch {}
  }, [status.proximityAlert]);

  if (!status.proximityAlert) return null;

  return (
    <div style={{
      position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
      zIndex: 2000, maxWidth: 420, width: 'calc(100% - 32px)',
      background: 'var(--color-surface, #121B2E)',
      border: '2px solid var(--color-accent, #F2A93C)',
      borderRadius: 'var(--radius-lg, 12px)',
      padding: '14px 18px',
      boxShadow: 'var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.5))',
      display: 'flex', flexDirection: 'column', gap: 10,
      animation: 'dt-fade-in-up 0.3s ease-out',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-accent)' }}>
          📍 Livraison : {status.proximityDeliveryTitle}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => {
              soundEnabledRef.current = !soundEnabledRef.current;
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: soundEnabledRef.current ? 'var(--color-text-tertiary)' : 'var(--color-red)',
              padding: 4, display: 'flex',
            }}
            title={soundEnabledRef.current ? 'Couper le son' : 'Son coupé'}
          >
            {soundEnabledRef.current ? <Bell size={16} /> : <BellOff size={16} />}
          </button>
          <button
            onClick={status.dismissProximityAlert}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-text-tertiary)', padding: 4,
              fontSize: '0.8rem',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
        Vous êtes à proximité du point de livraison. N'oubliez pas de valider la livraison.
      </p>

      <button
        onClick={() => { navigate('/my-deliveries'); status.dismissProximityAlert(); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '8px 16px',
          background: 'var(--color-accent, #F2A93C)',
          color: 'var(--color-bg, #0B1220)',
          border: 'none', borderRadius: 'var(--radius-md, 6px)',
          fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <ArrowRight size={16} />
        Valider la livraison
      </button>
    </div>
  );
}
