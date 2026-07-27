import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import api from '../../services/api/client';
import styles from './SuccessPage.module.css';

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
    <div className={styles.container}>
      <div className={styles.card}>
        {status === 'loading' && (
          <>
            <Loader2 size={48} className={styles.loadingIcon} />
            <h2 className={styles.heading}>
              {t('billing.success.loading')}
            </h2>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle size={48} className={styles.successIcon} />
            <h2 className={styles.heading}>
              {t('billing.success.successTitle')}
            </h2>
            <p className={styles.text}>
              {t('billing.success.successMessage')}
            </p>
            <div className={styles.actions}>
              <Link to="/billing" className={styles.primaryLink}>
                {t('billing.success.viewSubscription')}
              </Link>
              <Link to="/deliveries" className={styles.secondaryLink}>
                {t('billing.success.manageDeliveries')}
              </Link>
            </div>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 className={styles.heading}>
              {t('billing.success.errorTitle')}
            </h2>
            <p className={styles.text}>
              {t('billing.success.errorMessage')}
            </p>
            <Link to="/billing" className={styles.errorLink}>
              {t('billing.success.viewBilling')}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
