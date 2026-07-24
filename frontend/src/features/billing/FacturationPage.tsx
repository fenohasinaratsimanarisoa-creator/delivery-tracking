import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2 } from 'lucide-react';
import api from '../../services/api/client';
import { formatDate } from '../../services/i18n/formatDate';
import type { Invoice, CompanyUsage } from '../../types';

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
    <div style={{ padding: 'var(--space-xl)', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1 style={{
          fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700,
          color: 'var(--color-text)', letterSpacing: '-0.02em', margin: 0,
        }}>
          {t('billing.invoices.title')}
        </h1>
        <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          {t('billing.invoices.subtitle')}
        </p>
      </div>

      {companyUsage && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-md)',
          marginBottom: 'var(--space-xl)',
        }}>
          {[
            { label: t('billing.invoices.deliveries'), used: companyUsage.deliveriesUsed, limit: companyUsage.deliveriesLimit },
            { label: t('billing.invoices.vehicles'), used: companyUsage.vehiclesUsed, limit: companyUsage.vehiclesLimit },
            { label: t('billing.invoices.users'), used: companyUsage.usersUsed, limit: companyUsage.usersLimit },
          ].map((item) => {
            const pct = item.limit > 0 ? Math.round((item.used / item.limit) * 100) : 0;
            const isWarning = pct >= 80;
            const isCritical = pct >= 100;
            return (
              <div key={item.label} style={{
                background: 'var(--color-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border-subtle)',
                padding: 'var(--space-lg)',
              }}>
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {item.label}
                </p>
                <p style={{ margin: 'var(--space-xs) 0', fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)' }}>
                  {item.used}
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
                    /{item.limit}
                  </span>
                </p>
                <div style={{
                  height: 4, background: 'var(--color-border-subtle)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
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
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4xl)' }}>
          <Loader2 size={24} style={{ animation: 'dt-spin 0.6s linear infinite' }} />
        </div>
      ) : invoices.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 'var(--space-4xl)',
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          <FileText size={32} style={{ color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-md)' }} />
          <p style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', margin: 0 }}>
            {t('billing.invoices.empty')}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-xs)' }}>
            {t('billing.invoices.emptyDesc')}
          </p>
        </div>
      ) : (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border-subtle)', overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {[t('billing.invoices.table.invoice'), t('billing.invoices.table.date'), t('billing.invoices.table.amount'), t('billing.invoices.table.status'), ''].map((l) => (
                  <th key={l} style={{
                    padding: 'var(--space-md) var(--space-lg)', fontWeight: 600,
                    fontSize: 'var(--text-xs)', textTransform: 'uppercase',
                    letterSpacing: '0.05em', color: 'var(--color-text-secondary)',
                    textAlign: l === '' ? 'right' : 'left',
                  }}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                      {inv.invoiceNumber}
                    </span>
                  </td>
                  <td style={{ padding: 'var(--space-md) var(--space-lg)', color: 'var(--color-text-secondary)' }}>
                    {formatDate(inv.createdAt)}
                  </td>
                  <td style={{ padding: 'var(--space-md) var(--space-lg)', fontWeight: 600 }}>
                    {(inv.amount / 100).toFixed(2)} {inv.currency}
                  </td>
                  <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)', fontWeight: 500,
                      fontFamily: 'var(--font-mono)',
                      background: `${STATUS_COLORS[inv.status] || '#6b7280'}20`,
                      color: STATUS_COLORS[inv.status] || '#6b7280',
                    }}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </td>
                  <td style={{ padding: 'var(--space-md) var(--space-lg)', textAlign: 'right' }}>
                    <button
                      onClick={() => handleDownload(inv.id)}
                      title={t('billing.invoices.download')}
                      style={{
                        background: 'transparent', border: 'none',
                        cursor: 'pointer', color: 'var(--color-text-tertiary)',
                        padding: 'var(--space-xs)',
                      }}
                    >
                      <Download size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {meta.totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, padding: 'var(--space-lg)' }}>
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                style={{
                  padding: '6px 12px', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', background: 'transparent',
                  color: 'var(--color-text)', cursor: page <= 1 ? 'default' : 'pointer',
                  opacity: page <= 1 ? 0.5 : 1,
                }}
              >
                ←
              </button>
              {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    padding: '6px 12px', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: p === page ? 'var(--color-accent)' : 'transparent',
                    color: p === page ? 'var(--color-bg)' : 'var(--color-text)',
                    cursor: 'pointer', fontWeight: p === page ? 700 : 400,
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
                style={{
                  padding: '6px 12px', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', background: 'transparent',
                  color: 'var(--color-text)', cursor: page >= meta.totalPages ? 'default' : 'pointer',
                  opacity: page >= meta.totalPages ? 0.5 : 1,
                }}
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
