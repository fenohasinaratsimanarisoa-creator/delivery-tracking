import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../services/api/client';
import { Link } from 'react-router-dom';
import styles from './QuotaBanner.module.css';

export default function QuotaBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  const { data: usage } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => api.get('/billing/usage').then(({ data }) => data),
    refetchInterval: 60_000,
  });

  if (!usage || dismissed) return null;

  const warnings: { i18nKey: string; used: number; limit: number }[] = [];
  const thresholds = [
    { i18nKey: 'components.quotaBanner.deliveryUsage', used: usage.deliveriesUsed, limit: usage.deliveriesLimit },
    { i18nKey: 'components.quotaBanner.vehicleUsage', used: usage.vehiclesUsed, limit: usage.vehiclesLimit },
    { i18nKey: 'components.quotaBanner.userUsage', used: usage.usersUsed, limit: usage.usersLimit },
  ];

  for (const t of thresholds) {
    if (t.limit === 0) continue;
    const pct = (t.used / t.limit) * 100;
    if (pct >= 80) {
      warnings.push(t);
    }
  }

  if (warnings.length === 0) return null;

  return (
    <div className={styles.banner}>
      <AlertTriangle size={16} className={styles.alertIcon} />
      <span className={styles.message}>
        {warnings.map((w) => t(w.i18nKey, { used: w.used, limit: w.limit })).join(' · ')} —{' '}
        <Link to="/billing" className={styles.upgradeLink}>
          {t('components.quotaBanner.upgrade')}
        </Link>
      </span>
      <button
        onClick={() => setDismissed(true)}
        className={styles.dismissButton}
      >
        <X size={14} />
      </button>
    </div>
  );
}
