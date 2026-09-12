import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2 } from 'lucide-react';
import api from '../../services/api/client';
import { formatDate } from '../../services/i18n/formatDate';
import DataTable from '../../components/DataTable';
import Badge, { type BadgeVariant } from '../../components/Badge';
import type { Invoice, CompanyUsage } from '../../types';
import styles from './FacturationPage.module.css';

// Une seule table statut → variante pour toute la page (voir aussi
// services/deliveryStatus.ts pour le même principe côté livraisons).
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'neutral',
  open: 'blue',
  paid: 'teal',
  uncollectible: 'red',
  void: 'neutral',
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
        <DataTable
          keyExtractor={(inv: Invoice) => inv.id}
          total={meta.total}
          page={page}
          limit={meta.limit}
          onPageChange={setPage}
          columns={[
            {
              key: 'invoiceNumber',
              label: t('billing.invoices.table.invoice'),
              render: (inv) => <span className={styles.tableCellMono}>{inv.invoiceNumber}</span>,
            },
            {
              key: 'createdAt',
              label: t('billing.invoices.table.date'),
              render: (inv) => <span className={styles.tableCellSecondary}>{formatDate(inv.createdAt)}</span>,
            },
            {
              key: 'amount',
              label: t('billing.invoices.table.amount'),
              align: 'right',
              render: (inv) => <span className={styles.tableCellBold}>{(inv.amount / 100).toFixed(2)} {inv.currency}</span>,
            },
            {
              key: 'status',
              label: t('billing.invoices.table.status'),
              render: (inv) => (
                <Badge variant={STATUS_VARIANT[inv.status] || 'neutral'} size="sm">
                  {STATUS_LABELS[inv.status] || inv.status}
                </Badge>
              ),
            },
            {
              key: 'download',
              label: t('common.actions'),
              align: 'right',
              render: (inv) => (
                <button
                  onClick={() => handleDownload(inv.id)}
                  title={t('billing.invoices.download')}
                  aria-label={t('billing.invoices.download')}
                  className={styles.downloadBtn}
                >
                  <Download size={16} />
                </button>
              ),
            },
          ]}
          data={invoices}
        />
      )}
    </div>
  );
}
