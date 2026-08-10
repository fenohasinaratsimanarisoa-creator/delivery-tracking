import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Package } from 'lucide-react';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import type { Delivery } from '../types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', assigned: '#06b6d4', in_progress: '#3b82f6',
  delivered: '#22c55e', failed: '#ef4444', cancelled: '#6b7280',
};

// Fallback 100vh → 100dvh (dynamic viewport height, WebView Android moderne) : avec le
// clavier ouvert, 100vh dépasse la zone visible et un fond quasi-noir (#0B1220) sur un
// conteneur mal dimensionné reproduit le rectangle noir décrit. (Deux déclarations
// successives — la dernière écrase la première si dvh est supporté, sinon ignorée.)
const PAGE_WRAPPER_STYLE: React.CSSProperties = {
  padding: 'var(--space-2xl, 32px)',
  background: 'var(--color-bg, #0B1220)',
  ...({ minHeight: '100vh' } as React.CSSProperties),
  ...({ minHeight: '100dvh' } as React.CSSProperties),
};

export default function MyOrdersPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.get('/deliveries/my-orders').then((r) => r.data),
  });

  const deliveries: Delivery[] = data?.data ?? [];

  const filtered = filter
    ? deliveries.filter((d) => d.status === filter)
    : deliveries;

  if (isLoading) {
    return (
      <div style={PAGE_WRAPPER_STYLE}>
        <h1 style={{
          color: 'var(--color-text, #E8ECF3)',
          fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
          fontSize: 'var(--text-2xl, 1.5rem)', fontWeight: 700,
          marginBottom: 'var(--space-xl, 20px)',
        }}>
          {t('myOrders.title')}
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 12px)' }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 100,
              background: 'var(--color-skeleton, rgba(255,255,255,0.04))',
              borderRadius: 'var(--radius-lg, 8px)',
              animation: 'dt-shimmer 1.5s infinite linear',
              backgroundImage: 'linear-gradient(90deg, var(--color-skeleton, rgba(255,255,255,0.04)) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton, rgba(255,255,255,0.04)) 75%)',
              backgroundSize: '200% 100%',
            }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE_WRAPPER_STYLE}>
      <h1 style={{
        color: 'var(--color-text, #E8ECF3)',
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
        fontSize: 'var(--text-2xl, 1.5rem)', fontWeight: 700,
        marginBottom: 'var(--space-lg, 16px)',
      }}>
        {t('myOrders.title')}
      </h1>

      <div style={{ marginBottom: 'var(--space-lg, 16px)' }}>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
            borderRadius: 'var(--radius-md, 6px)',
            fontSize: 'var(--text-sm, 0.875rem)',
            background: 'var(--color-input-bg, #121B2E)',
            color: 'var(--color-text, #E8ECF3)',
            outline: 'none',
            minWidth: 200,
            fontFamily: 'var(--font-body, Inter, sans-serif)',
          }}
        >
          <option value="">{t('myOrders.filterAll')}</option>
          <option value="pending">{t('myOrders.status.pending')}</option>
          <option value="assigned">{t('myOrders.status.assigned')}</option>
          <option value="in_progress">{t('myOrders.status.in_progress')}</option>
          <option value="delivered">{t('myOrders.status.delivered')}</option>
          <option value="failed">{t('myOrders.status.failed')}</option>
          <option value="cancelled">{t('myOrders.status.cancelled')}</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 40,
          color: 'var(--color-text-tertiary, #7A8BA3)',
          background: 'var(--color-surface, #121B2E)',
          borderRadius: 'var(--radius-xl, 12px)',
          border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
        }}>
          <Package size={40} style={{ marginBottom: 12, color: 'var(--color-text-tertiary, #7A8BA3)', opacity: 0.5 }} />
          <p style={{ fontSize: '1.1rem', color: 'var(--color-text, #E8ECF3)' }}>{t('myOrders.empty')}</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 12px)' }}>
        {filtered.map((d) => (
          <div
            key={d.id}
            style={{
              background: 'var(--color-surface, #121B2E)',
              borderRadius: 'var(--radius-lg, 8px)',
              padding: 'var(--space-lg, 16px)',
              border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
              cursor: d.status === 'in_progress' || d.status === 'assigned' ? 'pointer' : 'default',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={(e) => {
              if (d.status === 'in_progress' || d.status === 'assigned') {
                e.currentTarget.style.borderColor = 'var(--color-accent, #F2A93C)';
                e.currentTarget.style.boxShadow = '0 0 0 1px var(--color-accent, #F2A93C)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle, rgba(232,236,243,0.08))';
              e.currentTarget.style.boxShadow = 'none';
            }}
            onClick={() => {
              if (d.status === 'in_progress' || d.status === 'assigned') {
                navigate(`/tracking?deliveryId=${d.id}`);
              }
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <strong style={{ fontSize: 'var(--text-base, 1rem)', color: 'var(--color-text, #E8ECF3)' }}>{d.title}</strong>
                <StatusBadge status={d.status} />
              </div>
              <div style={{ fontSize: 'var(--text-xs, 0.8rem)', color: 'var(--color-text-tertiary, #7A8BA3)' }}>
                {formatDate(d.createdAt)}
              </div>
            </div>

            <div style={{ fontSize: 'var(--text-sm, 0.85rem)', color: 'var(--color-text-secondary, #9BA6B9)' }}>
              <div>{d.deliveryAddress}</div>
              {d.scheduledDate && (
                <div style={{ color: 'var(--color-accent, #F2A93C)', marginTop: 2 }}>
                  📅 {formatDate(d.scheduledDate)}
                </div>
              )}
              {d.notes && (
                <div style={{
                  marginTop: 4, padding: '6px 8px',
                  background: 'var(--color-accent-bg, rgba(242,169,60,0.06))',
                  borderLeft: '3px solid var(--color-accent, #F2A93C)',
                  borderRadius: '0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0',
                  fontSize: 'var(--text-xs, 0.75rem)',
                  whiteSpace: 'pre-wrap',
                }}>
                  📝 {d.notes}
                </div>
              )}
              {d.driver && <div style={{ marginTop: 2 }}>{t('myOrders.driver')} : {d.driver.firstName} {d.driver.lastName}</div>}
            </div>

            {(d.status === 'in_progress' || d.status === 'assigned') && (
              <div style={{
                marginTop: 'var(--space-sm, 8px)',
                fontSize: 'var(--text-xs, 0.8rem)',
                color: 'var(--color-accent, #F2A93C)',
                fontWeight: 500,
              }}>
                {t('myOrders.trackLink')} →
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const bg = STATUS_COLORS[status] || '#6b7280';
  return (
    <span style={{
      background: `${bg}20`,
      color: bg,
      padding: '2px var(--space-sm, 8px)',
      borderRadius: 'var(--radius-sm, 4px)',
      fontSize: 'var(--text-xs, 0.75rem)',
      marginLeft: 8,
      fontWeight: 500,
    }}>
      {status === 'in_progress' ? t('myOrders.status.in_progress')
        : status === 'delivered' ? t('myOrders.status.delivered')
        : status === 'assigned' ? t('myOrders.status.assigned')
        : status === 'failed' ? t('myOrders.status.failed')
        : status === 'cancelled' ? t('myOrders.status.cancelled')
        : status === 'pending' ? t('myOrders.status.pending')
        : status}
    </span>
  );
}