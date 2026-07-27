import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2 } from 'lucide-react';
import api from '../../services/api/client';
import { formatDate } from '../../services/i18n/formatDate';
import type { Invoice, CompanyUsage } from '../../types';
import styles from './FacturationPage.module.css';

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-text-tertiary)',
  open: 'var(--color-accent)',
  paid: 'var(--color-teal)',
  uncollectible: 'var(--color-red)',
  void: '#6b7280',
};

export default function FacturationPage() {
  const { t } = useTranslation();
  const STATUS_LABELS: Record<string, string> = {
    draft: t('billing.invoices.status.draft'),
    open: t('billing.invoices.status.open'),
    paid: t('billing.invoices.status.paid'),
    uncollectible: t('billing.invoices.status.uncollectible'),
    void: t('billing.invoices.status.void'),
  };
  const [page, setPage] = useState(1);

  const { data: invoicesData, isLoading } = useQuery({
    queryKey: ['billing-invoices', page],
    queryFn: () => api.get(`/billing/invoices?page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: usage } = useQuery({
    queryKey: ['billing-usage'],
    queryFn: () => api.get('/billing/usage').then((r) => r.data),
  });

  const invoices: Invoice[] = invoicesData?.data ?? [];
  const meta = invoicesData?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };
  const companyUsage: CompanyUsage | null = usage ?? null;

  const handleDownload = async (invoiceId: string) => {
    try {
      const res = await api.get(`/billing/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `facture-${invoiceId.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {t('billing.invoices.title')}
        </h1>
        <p className={styles.subtitle}>
          {t('billing.invoices.subtitle')}
        </p>
      </div>

      {companyUsage && (
        <div className={styles.usageGrid}>
          {[
            { label: t('billing.invoices.deliveries'), used: companyUsage.deliveriesUsed, limit: companyUsage.deliveriesLimit },
            { label: t('billing.invoices.vehicles'), used: companyUsage.vehiclesUsed, limit: companyUsage.vehiclesLimit },
            { label: t('billing.invoices.users'), used: companyUsage.usersUsed, limit: companyUsage.usersLimit },
          ].map((item) => {
            const pct = item.limit > 0 ? Math.round((item.used / item.limit) * 100) : 0;
            const isWarning = pct >= 80;
            const isCritical = pct >= 100;
            return (
              <div key={item.label} className={styles.usageCard}>
                <p className={styles.usageLabel}>
                  {item.label}
                </p>
                <p className={styles.usageValue}>
                  {item.used}
                  <span className={styles.usageLimit}>
                    /{item.limit}
                  </span>
                </p>
                <div className={styles.progressTrack}>
                  <div style={{
                    width: `${Math.min(pct, 100)}%`, height: '100%',
                    background: isCritical ? 'var(--color-red)' : isWarning ? 'var(--color-accent)' : 'var(--color-teal)',
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className={styles.loadingContainer}>
          <Loader2 size={24} className={styles.spinner} />
        </div>
      ) : invoices.length === 0 ? (
        <div className={styles.emptyState}>
          <FileText size={32} className={styles.emptyIcon} />
          <p className={styles.emptyText}>
            {t('billing.invoices.empty')}
          </p>
          <p className={styles.emptyDesc}>
            {t('billing.invoices.emptyDesc')}
          </p>
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                {[t('billing.invoices.table.invoice'), t('billing.invoices.table.date'), t('billing.invoices.table.amount'), t('billing.invoices.table.status'), ''].map((l) => (
                  <th key={l} className={`${styles.tableHeadCell} ${l === '' ? styles.tableHeadCellRight : styles.tableHeadCellLeft}`}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className={styles.tableRow}>
                  <td className={styles.tableCell}>
                    <span className={styles.tableCellMono}>
                      {inv.invoiceNumber}
                    </span>
                  </td>
                  <td className={`${styles.tableCell} ${styles.tableCellSecondary}`}>
                    {formatDate(inv.createdAt)}
                  </td>
                  <td className={`${styles.tableCell} ${styles.tableCellBold}`}>
                    {(inv.amount / 100).toFixed(2)} {inv.currency}
                  </td>
                  <td className={styles.tableCell}>
                    <span className={styles.statusBadge} style={{
                      background: `${STATUS_COLORS[inv.status] || '#6b7280'}20`,
                      color: STATUS_COLORS[inv.status] || '#6b7280',
                    }}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </td>
                  <td className={styles.tableCell} style={{ textAlign: 'right' }}>
                    <button
                      onClick={() => handleDownload(inv.id)}
                      title={t('billing.invoices.download')}
                      className={styles.downloadBtn}
                    >
                      <Download size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta.totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className={styles.pageBtn}
              >
                ←
              </button>
              {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                >
                  {p}
                </button>
              ))}
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
                className={styles.pageBtn}
              >
                →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
