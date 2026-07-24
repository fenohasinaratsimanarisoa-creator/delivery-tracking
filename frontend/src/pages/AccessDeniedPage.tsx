import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function AccessDeniedPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 40, textAlign: 'center',
      background: 'var(--color-bg, #0B1220)',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: 8 }}>🚫</div>
      <h2 style={{
        margin: '0 0 8px',
        color: 'var(--color-text, #E8ECF3)',
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
      }}>
        {t('errors.403.heading')}
      </h2>
      <p style={{
        margin: '0 0 24px', fontSize: 'var(--text-sm, 0.875rem)',
        color: 'var(--color-text-secondary, #9BA6B9)',
      }}>
        {t('errors.403.message')}
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '11px 24px',
          background: 'var(--color-accent, #F2A93C)',
          color: 'var(--color-bg, #0B1220)',
          border: 'none', borderRadius: 'var(--radius-md, 6px)',
          cursor: 'pointer', fontSize: 'var(--text-sm, 0.875rem)',
          fontWeight: 600, fontFamily: 'var(--font-body, Inter, sans-serif)',
        }}
      >
        <ArrowLeft size={16} /> {t('errors.403.backToDashboard')}
      </button>
    </div>
  );
}