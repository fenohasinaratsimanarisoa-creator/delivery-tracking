import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, X, Check, Clock, MapPin, Gauge, Fuel, Wifi, Package } from 'lucide-react';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../services/i18n/formatDate';
import { io } from 'socket.io-client';
import { getAccessToken } from '../services/auth/tokenStore';

interface AlertItem {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  link?: string;
  deliveryId?: string;
  delivery?: { id: string; title: string; status: string; deliveryAddress: string };
  userId?: string;
  user?: { id: string; firstName: string; lastName: string };
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: { id: string; firstName: string; lastName: string };
  resolutionComment?: string;
  readAt?: string;
  createdAt: string;
}

interface AlertStats {
  total: number;
  byPriority: { priority: string; _count: number }[];
  byType: { type: string; _count: number }[];
  prevTotal: number | null;
}

const PRIORITY_COLORS: Record<string, string> = { critical: '#dc2626', high: '#f97316', medium: '#eab308', low: '#22c55e' };
const PERIOD_VALUES = ['today', '7d', '30d', 'all'] as const;

export default function AlertsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const PRIORITY_LABELS: Record<string, string> = {
    critical: t('alerts.priority.critical'), high: t('alerts.priority.high'),
    medium: t('alerts.priority.medium'), low: t('alerts.priority.low'),
  };
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  const [resolvedFilter, setResolvedFilter] = useState<string>('false');
  const [period, setPeriod] = useState('7d');
  const [selectedAlert, setSelectedAlert] = useState<AlertItem | null>(null);
  const [resolveComment, setResolveComment] = useState('');
  const [liveCount, setLiveCount] = useState(0);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', '50');
    if (selectedTypes.length) p.set('types', selectedTypes.join(','));
    if (selectedPriorities.length) p.set('priorities', selectedPriorities.join(','));
    if (resolvedFilter === 'true') p.set('resolved', 'true');
    else if (resolvedFilter === 'false') p.set('resolved', 'false');
    p.set('period', period);
    return p.toString();
  }, [page, selectedTypes, selectedPriorities, resolvedFilter, period]);

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', queryParams],
    queryFn: () => api.get(`/alerts?${queryParams}`).then((r) => r.data),
    refetchInterval: 10000,
  });

  const { data: stats } = useQuery({
    queryKey: ['alerts-stats', period],
    queryFn: () => api.get(`/alerts/stats?period=${period}`).then((r) => r.data),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      api.patch(`/alerts/${id}/resolve`, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      queryClient.invalidateQueries({ queryKey: ['alerts-stats'] });
      setSelectedAlert(null);
      setResolveComment('');
      toast(t('alerts.toast.resolved'));
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || t('alerts.toast.error'), 'error');
    },
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let socket: any;
    try {
      socket = io('/notifications', {
        auth: (cb: (data: { token: string }) => void) => cb({ token: getAccessToken() || '' }),
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 1000,
      });
      socket.on('notification', () => {
        setLiveCount((c) => c + 1);
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
        queryClient.invalidateQueries({ queryKey: ['alerts-stats'] });
      });
    } catch {}
    return () => { try { socket?.disconnect(); } catch {} };
  }, [queryClient]);

  const alerts: AlertItem[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0 };
  const alertStats: AlertStats | undefined = stats;

  const toggleType = (t: string) => { setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); setPage(1); };
  const togglePriority = (p: string) => { setSelectedPriorities((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]); setPage(1); };

  const typeConfig = useMemo(() => ({
    speed_alert: { icon: <Gauge size={16} />, borderColor: '#f97316' },
    prolonged_stop: { icon: <Clock size={16} />, borderColor: '#eab308' },
    delay_alert: { icon: <Clock size={16} />, borderColor: '#f97316' },
    device_offline: { icon: <Wifi size={16} />, borderColor: '#eab308' },
    geofence_event: { icon: <MapPin size={16} />, borderColor: '#f97316' },
    delivery_status: { icon: <Package size={16} />, borderColor: '#22c55e' },
    location_mismatch: { icon: <MapPin size={16} />, borderColor: '#f97316' },
    fuel_anomaly: { icon: <Fuel size={16} />, borderColor: '#f97316' },
    maintenance_due: { icon: <Bell size={16} />, borderColor: '#eab308' },
    system: { icon: <Bell size={16} />, borderColor: '#6b7280' },
  }), []);

  const trendPercent = useMemo(() => {
    if (!alertStats?.prevTotal || alertStats.prevTotal === 0) return null;
    return Math.round(((alertStats.total - alertStats.prevTotal) / alertStats.prevTotal) * 100);
  }, [alertStats]);

  const allTypes = ['speed_alert', 'prolonged_stop', 'delay_alert', 'device_offline', 'geofence_event', 'delivery_status', 'location_mismatch', 'fuel_anomaly'];
  const allPriorities = ['critical', 'high', 'medium', 'low'];

  return (
    <div className="page-padding" style={{ padding: 24, height: '100%', overflow: 'auto', maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text)' }}>
          <Bell size={22} style={{ color: 'var(--color-accent, #F2A93C)' }} />
          {t('alerts.title')}
          {alertStats && alertStats.total > 0 && (
            <span style={{ fontSize: '0.8rem', background: '#ef444420', color: '#ef4444', padding: '2px 10px', borderRadius: 9999, fontWeight: 600 }}>
              {t('alerts.unresolvedCount', { count: alertStats.total })}
            </span>
          )}
        </h1>
        {liveCount > 0 && (
          <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 500 }}>
            🔴 {t('alerts.liveCount', { count: liveCount })}
          </span>
        )}
      </div>

      {alertStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
          <KpiCard label={t('alerts.kpiUnresolved')} value={alertStats.total} color="#ef4444" trend={trendPercent} />
          {allPriorities.map((prio) => {
            const count = alertStats.byPriority.find((p) => p.priority === prio)?._count ?? 0;
            if (count === 0) return null;
            return <KpiCard key={prio} label={PRIORITY_LABELS[prio]} value={count} color={PRIORITY_COLORS[prio]} />;
          })}
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {PERIOD_VALUES.map((val) => (
            <FilterChip key={val} active={period === val} onClick={() => { setPeriod(val); setPage(1); }}>{t(`alerts.filters.period${val}`)}</FilterChip>
          ))}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('alerts.filters.type')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {allTypes.map((tp) => (
            <FilterChip key={tp} active={selectedTypes.includes(tp)} onClick={() => toggleType(tp)}>
              {t(`alerts.type.${tp}`, tp)}
            </FilterChip>
          ))}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase' }}>{t('alerts.filters.gravity')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {allPriorities.map((prio) => (
            <FilterChip key={prio} active={selectedPriorities.includes(prio)} onClick={() => togglePriority(prio)} color={PRIORITY_COLORS[prio]}>{PRIORITY_LABELS[prio]}</FilterChip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <FilterChip active={resolvedFilter === ''} onClick={() => { setResolvedFilter(''); setPage(1); }}>{t('alerts.filters.all')}</FilterChip>
          <FilterChip active={resolvedFilter === 'false'} onClick={() => { setResolvedFilter('false'); setPage(1); }} color="#ef4444">{t('alerts.filters.unresolved')}</FilterChip>
          <FilterChip active={resolvedFilter === 'true'} onClick={() => { setResolvedFilter('true'); setPage(1); }} color="#22c55e">{t('alerts.filters.resolved')}</FilterChip>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ height: 72, borderRadius: 10, background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', opacity: 0.5, animation: 'dt-shimmer 1.5s infinite linear' }} />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-tertiary)' }}>
          <Bell size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p style={{ fontSize: '1rem', fontWeight: 500 }}>{t('alerts.empty.title')}</p>
          <p style={{ fontSize: '0.8rem' }}>{t('alerts.empty.description')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {alerts.map((r) => {
            const cfg = typeConfig[r.type as keyof typeof typeConfig] || { icon: <Bell size={16} />, borderColor: '#6b7280' };
            return (
              <div
                key={r.id}
                onClick={() => setSelectedAlert(r)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px',
                  background: r.resolved ? 'var(--color-surface)' : 'var(--color-glass, rgba(18,27,46,0.92))',
                  border: `1px solid var(--color-border-subtle)`,
                  borderLeft: `3px solid ${r.resolved ? '#22c55e' : PRIORITY_COLORS[r.priority] || '#6b7280'}`,
                  borderRadius: 10, cursor: 'pointer',
                  opacity: r.resolved ? 0.7 : 1,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-hover, #1E2A45)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = r.resolved ? 'var(--color-surface)' : 'var(--color-glass, rgba(18,27,46,0.92))'; }}
              >
                <div style={{ color: PRIORITY_COLORS[r.priority] || '#6b7280', marginTop: 2, flexShrink: 0 }}>
                  {cfg.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text)' }}>{r.title}</span>
                    <span style={{ fontSize: '0.65rem', padding: '1px 7px', borderRadius: 9999, fontWeight: 600, background: `${PRIORITY_COLORS[r.priority] || '#6b7280'}15`, color: PRIORITY_COLORS[r.priority] || '#6b7280' }}>
                      {PRIORITY_LABELS[r.priority] || r.priority}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>{t(`alerts.type.${r.type}`, r.type)}</span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, marginBottom: 4 }}>
                    {r.message}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                    <span>{formatDateTime(r.createdAt)}</span>
                    {r.delivery && (
                      <Link to={`/deliveries/${r.delivery.id}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--color-accent, #F2A93C)', textDecoration: 'none' }}>
                        📦 {r.delivery.title}
                      </Link>
                    )}
                    {r.resolved && <span style={{ color: '#22c55e' }}>{t('alerts.resolvedLabel')}</span>}
                  </div>
                </div>
                <div style={{ flexShrink: 0, alignSelf: 'center' }}>
                  {!r.resolved ? (
                    <button onClick={(e) => { e.stopPropagation(); resolveMutation.mutate({ id: r.id }); }}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #22c55e40', background: '#22c55e10', color: '#22c55e', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {t('alerts.resolveButton')}
                    </button>
                  ) : (
                    <Check size={16} style={{ color: '#22c55e' }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {meta.total > 50 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
            {t('alerts.pagination.previous')}
          </button>
          <span style={{ padding: '6px 14px', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{t('alerts.pagination.page')} {page}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={alerts.length < 50}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--color-border-subtle)', background: 'var(--color-surface)', color: 'var(--color-text)', cursor: alerts.length < 50 ? 'default' : 'pointer', opacity: alerts.length < 50 ? 0.5 : 1 }}>
            {t('alerts.pagination.next')}
          </button>
        </div>
      )}

      {selectedAlert && (
        <>
          <div onClick={() => { setSelectedAlert(null); setResolveComment(''); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '90vw', background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border-subtle)', boxShadow: '-8px 0 32px rgba(0,0,0,0.4)', zIndex: 1000, overflow: 'auto', padding: 28 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: 2 }}>
                  {t(`alerts.type.${selectedAlert.type}`, selectedAlert.type)}
                </div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--color-text)' }}>{selectedAlert.title}</h2>
              </div>
              <button onClick={() => { setSelectedAlert(null); setResolveComment(''); }} style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <Badge color={PRIORITY_COLORS[selectedAlert.priority]}>{PRIORITY_LABELS[selectedAlert.priority]}</Badge>
              <Badge color={selectedAlert.resolved ? '#22c55e' : '#ef4444'}>{selectedAlert.resolved ? t('alerts.resolved') : t('alerts.active')}</Badge>
            </div>

            <Section label={t('alerts.drawer.message')}>{selectedAlert.message}</Section>

            {selectedAlert.delivery && (
              <Section label={t('alerts.drawer.delivery')}>
                <Link to={`/deliveries/${selectedAlert.delivery.id}`} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>
                  {selectedAlert.delivery.title}
                </Link>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{selectedAlert.delivery.deliveryAddress}</div>
              </Section>
            )}

            {selectedAlert.user && <Section label={t('alerts.drawer.driver')}>{selectedAlert.user.firstName} {selectedAlert.user.lastName}</Section>}

            <Section label={t('alerts.drawer.date')}>{formatDateTime(selectedAlert.createdAt)}</Section>

            {selectedAlert.link && (
              <Section label={t('alerts.drawer.directLink')}>
                <Link to={selectedAlert.link} style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>{t('alerts.drawer.viewDetail')}</Link>
              </Section>
            )}

            {selectedAlert.resolved && selectedAlert.resolvedBy && (
              <Section label={t('alerts.drawer.resolution')}>
                <div>{t('alerts.drawer.resolvedBy', { firstName: selectedAlert.resolvedBy.firstName, lastName: selectedAlert.resolvedBy.lastName, date: formatDateTime(selectedAlert.resolvedAt!) })}</div>
                {selectedAlert.resolutionComment && (
                  <div style={{ marginTop: 8, padding: 10, background: 'var(--color-surface-alt)', borderRadius: 6, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{selectedAlert.resolutionComment}</div>
                )}
              </Section>
            )}

            {!selectedAlert.resolved && (
              <div style={{ marginTop: 20, padding: 16, background: 'var(--color-surface-alt)', borderRadius: 10 }}>
                <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-text)' }}>{t('alerts.drawer.markResolved')}</div>
                <textarea placeholder={t('alerts.drawer.commentPlaceholder')} value={resolveComment} onChange={(e) => setResolveComment(e.target.value)} rows={3}
                  style={{ width: '100%', padding: 8, background: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', borderRadius: 6, color: 'var(--color-text)', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical', marginBottom: 10 }} />
                <button onClick={() => resolveMutation.mutate({ id: selectedAlert.id, comment: resolveComment })} disabled={resolveMutation.isPending}
                  style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#22c55e', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                  {resolveMutation.isPending ? t('alerts.drawer.resolving') : t('alerts.drawer.confirmResolve')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, color, trend }: { label: string; value: number; color: string; trend?: number | null }) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 500, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</div>
      {trend !== null && trend !== undefined && (
        <div style={{ fontSize: '0.65rem', color: trend > 0 ? '#ef4444' : trend < 0 ? '#22c55e' : 'var(--color-text-tertiary)', marginTop: 2 }}>
          {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : '='}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{children}</div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ padding: '3px 10px', borderRadius: 9999, fontSize: '0.7rem', fontWeight: 600, background: `${color}15`, color }}>{children}</span>
  );
}

function FilterChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 9999, fontSize: '0.75rem', fontWeight: 500,
      border: active ? `1px solid ${color || 'var(--color-accent, #F2A93C)'}` : '1px solid var(--color-border-subtle)',
      background: active ? `${color || 'var(--color-accent, #F2A93C)'}15` : 'transparent',
      color: active ? (color || 'var(--color-accent, #F2A93C)') : 'var(--color-text-secondary)',
      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s ease',
    }}>{children}</button>
  );
}
