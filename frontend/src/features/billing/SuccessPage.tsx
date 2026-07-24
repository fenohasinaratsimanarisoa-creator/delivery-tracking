import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import api from '../../services/api/client';

export default function SuccessPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  useEffect(() => {
    const sessionId = searchParams.get('session_id');
    if (!sessionId) {
      setStatus('error');
      return;
    }

    if (sessionId.startsWith('sim_sub_')) {
      setTimeout(() => setStatus('success'), 800);
      return;
    }

    api.get('/billing/subscription')
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [searchParams]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '60vh', padding: 'var(--space-xl)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        {status === 'loading' && (
          <>
            <Loader2 size={48} style={{ animation: 'dt-spin 0.6s linear infinite', color: 'var(--color-accent)' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)', marginTop: 'var(--space-lg)' }}>
              {t('billing.success.loading')}
            </h2>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} style={{ color: 'var(--color-teal)' }} />
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)', marginTop: 'var(--space-lg)' }}>
              {t('billing.success.successTitle')}
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
              {t('billing.success.successMessage')}
            </p>
            <div style={{ marginTop: 'var(--space-xl)', display: 'flex', gap: 'var(--space-md)', justifyContent: 'center' }}>
              <Link to="/billing" style={{
                padding: 'var(--space-sm) var(--space-lg)',
                background: 'var(--color-accent)', color: 'var(--color-bg)',
                borderRadius: 'var(--radius-md)', textDecoration: 'none',
                fontSize: 'var(--text-sm)', fontWeight: 600,
                fontFamily: 'var(--font-body)',
              }}>
                {t('billing.success.viewSubscription')}
              </Link>
              <Link to="/deliveries" style={{
                padding: 'var(--space-sm) var(--space-lg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', textDecoration: 'none',
                color: 'var(--color-text)', fontSize: 'var(--text-sm)', fontWeight: 500,
                fontFamily: 'var(--font-body)',
              }}>
                {t('billing.success.manageDeliveries')}
              </Link>
            </div>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
              {t('billing.success.errorTitle')}
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
              {t('billing.success.errorMessage')}
            </p>
            <Link to="/billing" style={{
              display: 'inline-block', marginTop: 'var(--space-lg)',
              padding: 'var(--space-sm) var(--space-lg)',
              background: 'var(--color-accent)', color: 'var(--color-bg)',
              borderRadius: 'var(--radius-md)', textDecoration: 'none',
              fontSize: 'var(--text-sm)', fontWeight: 600,
              fontFamily: 'var(--font-body)',
            }}>
              {t('billing.success.viewBilling')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
