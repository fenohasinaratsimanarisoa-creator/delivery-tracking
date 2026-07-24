import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../services/api/client';
import { Link } from 'react-router-dom';

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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
      padding: 'var(--space-sm) var(--space-lg)',
      background: 'var(--color-accent-muted)',
      borderBottom: '1px solid var(--color-accent)',
      fontSize: 'var(--text-sm)',
      color: 'var(--color-text)',
      fontFamily: 'var(--font-body)',
    }}>
      <AlertTriangle size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        {warnings.map((w) => t(w.i18nKey, { used: w.used, limit: w.limit })).join(' · ')} —{' '}
        <Link to="/billing" style={{ fontWeight: 600, textDecoration: 'underline' }}>
          {t('components.quotaBanner.upgrade')}
        </Link>
      </span>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--color-text-tertiary)', padding: 2,
          display: 'flex', alignItems: 'center',
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
