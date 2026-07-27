import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDateShort } from '../services/i18n/formatDate';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import Button from '../components/Button';
import type { Delivery } from '../types';

const statusColors: Record<string, { bg: string; color: string }> = {
  pending:    { bg: 'var(--color-accent-muted)', color: 'var(--color-accent)' },
  assigned:   { bg: 'var(--color-teal-muted)', color: 'var(--color-teal)' },
  in_progress:{ bg: 'rgba(0,123,255,0.15)', color: '#5BA3E6' },
  delivered:  { bg: 'var(--color-teal-muted)', color: 'var(--color-teal)' },
  failed:     { bg: 'var(--color-red-muted)', color: 'var(--color-red)' },
  cancelled:  { bg: 'var(--color-surface-alt)', color: 'var(--color-text-tertiary)' },
};

function captureGpsPosition(): Promise<{ latitude: number; longitude: number; accuracy?: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        reject(new Error(err.message || 'Geolocation failed'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export default function MyDeliveriesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [gpsLoading, setGpsLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => api.get('/deliveries/my-deliveries').then((r) => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, latitude, longitude, accuracy }: { id: string; status: string; latitude?: number; longitude?: number; accuracy?: number }) =>
      api.patch(`/deliveries/${id}/driver-status`, { status, latitude, longitude, accuracy }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
      toast(t('myDeliveries.toast.statusUpdated'));
      setGpsLoading(false);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('myDeliveries.toast.updateError'), 'error');
      setGpsLoading(false);
    },
  });

  const handleStatusUpdate = async (id: string, status: string) => {
    if (status === 'delivered' || status === 'failed') {
      setGpsLoading(true);
      try {
        const gps = await captureGpsPosition();
        updateMutation.mutate({ id, status, ...gps });
      } catch {
        toast(t('myDeliveries.toast.gpsRequired'), 'error');
        setGpsLoading(false);
      }
    } else {
      updateMutation.mutate({ id, status });
    }
  };

  const deliveries: Delivery[] = data?.data ?? [];

  if (isLoading) {
    return (
      <div style={{ padding: 20 }}>
        <h1 style={{ marginBottom: 20 }}>{t('myDeliveries.title')}</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{
              height: 120, borderRadius: 'var(--radius-lg, 8px)',
              background: 'var(--color-skeleton, #182339)',
              animation: 'dt-shimmer 1.5s infinite linear',
              backgroundImage: 'linear-gradient(90deg, var(--color-skeleton, #182339) 25%, var(--color-surface-hover, #1E2A45) 50%, var(--color-skeleton, #182339) 75%)',
              backgroundSize: '200% 100%',
            }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-xl, 24px)' }}>
      <h1 style={{
        marginBottom: 'var(--space-xl, 24px)',
        fontSize: 'var(--text-xl, 1.5rem)',
      }}>
        {t('myDeliveries.title')}
      </h1>

      {deliveries.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 'var(--space-3xl, 40px)',
          color: 'var(--color-text-tertiary, #7A8BA3)',
          background: 'var(--color-surface-alt, #182339)',
          borderRadius: 'var(--radius-lg, 8px)',
          border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 'var(--space-md, 12px)' }}>📭</div>
          <p style={{ fontSize: 'var(--text-md, 1rem)', fontWeight: 500 }}>{t('myDeliveries.empty')}</p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md, 12px)' }}>
        {deliveries.map((d) => {
          const isActive = d.status === 'in_progress';
          return (
            <div key={d.id} style={{
              background: isActive
                ? 'var(--color-glass, rgba(18,27,46,0.92))'
                : 'var(--color-surface, #121B2E)',
              borderRadius: 'var(--radius-lg, 8px)',
              padding: 'var(--space-lg, 16px)',
              border: isActive
                ? '1px solid var(--color-teal, #3FA796)'
                : '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
              position: 'relative',
              overflow: 'hidden',
              transition: 'background var(--transition-fast, 150ms) ease, border-color var(--transition-fast, 150ms) ease',
            }}>
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
                  background: 'var(--color-teal, #3FA796)',
                  borderTopLeftRadius: 'var(--radius-lg, 8px)',
                  borderBottomLeftRadius: 'var(--radius-lg, 8px)',
                }} />
              )}

              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'flex-start', marginBottom: 'var(--space-sm, 8px)',
                paddingLeft: isActive ? 12 : 0,
              }}>
                <div>
                  <strong style={{
                    fontSize: 'var(--text-md, 1rem)',
                    color: 'var(--color-text, #E8ECF3)',
                  }}>
                    {isActive && '🟢 '}{d.title}
                  </strong>
                  <StatusBadge status={d.status} />
                </div>
                <div style={{
                  fontSize: 'var(--text-xs, 0.625rem)',
                  color: 'var(--color-text-tertiary, #7A8BA3)',
                  whiteSpace: 'nowrap', marginLeft: 'var(--space-sm, 8px)',
                }}>
                  {formatDateShort(d.createdAt)}
                </div>
              </div>

              <div style={{
                fontSize: 'var(--text-sm, 0.75rem)',
                color: 'var(--color-text-secondary, #9BA6B9)',
                marginBottom: 'var(--space-md, 12px)',
                display: 'flex', flexDirection: 'column', gap: 4,
                paddingLeft: isActive ? 12 : 0,
              }}>
                <div>📍 {d.pickupAddress}</div>
                <div>🏁 {d.deliveryAddress}</div>
                {d.scheduledDate && (
                  <div style={{ color: 'var(--color-accent, #F2A93C)' }}>
                    📅 Planifiée le {formatDate(d.scheduledDate)}
                  </div>
                )}
                {d.notes && (
                  <div style={{
                    marginTop: 4, padding: '8px 10px',
                    background: 'var(--color-accent-bg, rgba(242,169,60,0.06))',
                    borderLeft: '3px solid var(--color-accent, #F2A93C)',
                    borderRadius: '0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0',
                    fontSize: 'var(--text-xs, 0.7rem)',
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                  }}>
                    📝 {d.notes}
                  </div>
                )}
                {d.vehicle && (
                  <div style={{ color: 'var(--color-text-tertiary, #7A8BA3)' }}>
                    🚛 {d.vehicle.brand} {d.vehicle.model} ({d.vehicle.licensePlate})
                  </div>
                )}
              </div>

              <ActionButtons
                status={d.status}
                loading={updateMutation.isPending || gpsLoading}
                onAction={(status) => handleStatusUpdate(d.id, status)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const sc = statusColors[status] || { bg: 'var(--color-surface-alt)', color: 'var(--color-text-tertiary)' };
  const labelMap: Record<string, string> = {
    pending: t('myDeliveries.status.pending'),
    assigned: t('myDeliveries.status.assigned'),
    in_progress: t('myDeliveries.status.in_progress'),
    delivered: t('myDeliveries.status.delivered'),
    failed: t('myDeliveries.status.failed'),
    cancelled: t('myDeliveries.status.cancelled'),
  };
  return (
    <span style={{
      background: sc.bg,
      color: sc.color,
      padding: '2px 10px', borderRadius: 'var(--radius-full, 9999px)',
      fontSize: 'var(--text-xs, 0.625rem)', fontWeight: 600,
      marginLeft: 8, whiteSpace: 'nowrap',
      transition: 'background var(--transition-fast, 150ms) ease, color var(--transition-fast, 150ms) ease',
    }}>
      {labelMap[status] || status}
    </span>
  );
}

function ActionButtons({ status, loading, onAction }: { status: string; loading: boolean; onAction: (s: string) => void }) {
  const { t } = useTranslation();

  if (status === 'assigned') {
    return (
      <div style={{ paddingLeft: 0 }}>
        <Button
          variant="primary"
          size="sm"
          loading={loading}
          onClick={() => onAction('in_progress')}
        >
          {t('myDeliveries.actions.takeCharge')}
        </Button>
      </div>
    );
  }

  if (status === 'in_progress') {
    return (
      <div style={{ display: 'flex', gap: 8, paddingLeft: 0 }}>
        <Button
          variant="outline"
          size="sm"
          loading={loading}
          onClick={() => onAction('delivered')}
        >
          {'✅ ' + t('myDeliveries.actions.deliver')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={loading}
          onClick={() => onAction('failed')}
        >
          {'❌ ' + t('myDeliveries.actions.fail')}
        </Button>
      </div>
    );
  }

  return null;
}