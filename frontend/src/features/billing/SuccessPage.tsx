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

    // On ne se fie JAMAIS au préfixe 'sim_sub_' ni au seul fait qu'une session_id
    // existe : on confirme toujours côté serveur que l'abonnement est bien 'active'
    // avant d'afficher le succès (même en mode simulé).
    api.get('/billing/subscription')
      .then((res) => {
        const sub = res.data as { status?: string } | null;
        if (sub?.status === 'active') {
          setStatus('success');
        } else {
          setStatus('error');
        }
      })
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
