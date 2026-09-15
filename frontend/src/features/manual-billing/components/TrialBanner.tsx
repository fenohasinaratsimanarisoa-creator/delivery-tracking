import { useQuery } from '@tanstack/react-query';
import { Clock, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import api from '../../../services/api/client';
import type { ManualBillingStatus } from '../../../types';
import styles from './TrialBanner.module.css';

// Paiement manuel 2026-09-15 : bandeau d'essai calqué sur QuotaBanner (même
// polling/dismiss), mais MONTÉ explicitement dans AppLayout (App.tsx) —
// QuotaBanner, lui, existe mais n'est jamais importé nulle part, donc ne
// s'affiche jamais. Ne pas reproduire cet oubli.
const WARNING_THRESHOLD_DAYS = 5;

export default function TrialBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['manual-billing-status'],
    queryFn: () => api.get<ManualBillingStatus>('/manual-billing/status').then(({ data }) => data),
    refetchInterval: 60_000,
  });

  if (!status || dismissed) return null;
  if (status.status !== 'trialing') return null;
  if (status.daysRemaining == null || status.daysRemaining > WARNING_THRESHOLD_DAYS) return null;

  return (
    <div className={styles.banner}>
      <Clock size={16} className={styles.icon} />
      <span className={styles.message}>
        {t('components.trialBanner.daysRemaining', { count: status.daysRemaining })} —{' '}
        <Link to="/paywall" className={styles.link}>
          {t('components.trialBanner.subscribe')}
        </Link>
      </span>
      <button onClick={() => setDismissed(true)} className={styles.dismissButton} aria-label={t('common.close')}>
        <X size={14} />
      </button>
    </div>
  );
}
