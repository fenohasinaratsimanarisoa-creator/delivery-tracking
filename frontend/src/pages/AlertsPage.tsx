import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell, X, Check, Clock, MapPin, Gauge, Fuel, Wifi } from 'lucide-react';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../services/i18n/formatDate';
import { io } from 'socket.io-client';
import { getAccessToken } from '../services/auth/tokenStore';

type ApiError = { response?: { data?: { message?: string } } };
import styles from './AlertsPage.module.css';

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

const PRIORITY_COLORS: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e' };
const PERIOD_VALUES = ['today', '7d', '30d', 'all'] as const;

export default function AlertsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const PRIORITY_LABELS: Record<string, string> = {
    critical: t('alerts.priority.critical'), high: t('alerts.priority.high'),
    medium: t('alerts.priority.medium'), low: t('alerts.priority.low'),
  };
  const PERIOD_LABELS: Record<string, string> = {
    today: t('alerts.filters.today'), '7d': t('alerts.filters.7days'),
    '30d': t('alerts.filters.30days'), all: t('alerts.filters.allTime'),
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
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    let socket: ReturnType<typeof io>;
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
    location_mismatch: { icon: <MapPin size={16} />, borderColor: '#f97316' },
    fuel_anomaly: { icon: <Fuel size={16} />, borderColor: '#f97316' },
  }), []);

  const trendPercent = useMemo(() => {
    if (!alertStats?.prevTotal || alertStats.prevTotal === 0) return null;
    return Math.round(((alertStats.total - alertStats.prevTotal) / alertStats.prevTotal) * 100);
  }, [alertStats]);

  const allTypes = ['speed_alert', 'prolonged_stop', 'delay_alert', 'device_offline', 'geofence_event', 'location_mismatch', 'fuel_anomaly'];
  const allPriorities = ['critical', 'high', 'medium', 'low'];

  return (
    <div className={styles.pageContainer}>
      <div className={styles.headerRow}>
        <h1 className={styles.pageTitle}>
          <Bell size={22} className={styles.titleIcon} />
          {t('alerts.title')}
          {alertStats && alertStats.total > 0 && (
            <span className={styles.unresolvedBadge}>
              {t('alerts.unresolvedCount', { count: alertStats.total })}
            </span>
          )}
        </h1>
        {liveCount > 0 && (
          <span className={styles.liveCount}>
            {t('alerts.liveNew', { count: liveCount })}
          </span>
        )}
      </div>

      {alertStats && (
        <div className={styles.kpiGrid}>
          <KpiCard label={t('alerts.kpiUnresolved')} value={alertStats.total} color="#ef4444" trend={trendPercent} />
          {allPriorities.map((prio) => {
            const count = alertStats.byPriority.find((p) => p.priority === prio)?._count ?? 0;
            if (count === 0) return null;
            return <KpiCard key={prio} label={PRIORITY_LABELS[prio]} value={count} color={PRIORITY_COLORS[prio]} />;
          })}
        </div>
      )}

      <div className={styles.filtersPanel}>
        <div>
          <div className={styles.filterLabel}>
            {t('alerts.filters.periodLabel')}
          </div>
          <div className={styles.filterChipsRow}>
            {PERIOD_VALUES.map((val) => (
              <FilterChip key={val} active={period === val} onClick={() => { setPeriod(val); setPage(1); }}>{PERIOD_LABELS[val]}</FilterChip>
            ))}
          </div>
        </div>

        <div>
          <div className={styles.filterLabel}>
            {t('alerts.filters.typeLabel')}
          </div>
          <div className={styles.filterChipsRow}>
            {allTypes.map((tp) => (
              <FilterChip key={tp} active={selectedTypes.includes(tp)} onClick={() => toggleType(tp)}>
                {t(`alerts.type.${tp}`, tp)}
              </FilterChip>
            ))}
          </div>
        </div>

        <div>
          <div className={styles.filterLabel}>
            {t('alerts.filters.priorityLabel')}
          </div>
          <div className={styles.filterChipsRow}>
            {allPriorities.map((prio) => (
              <FilterChip key={prio} active={selectedPriorities.includes(prio)} onClick={() => togglePriority(prio)} color={PRIORITY_COLORS[prio]}>
                {PRIORITY_LABELS[prio]}
              </FilterChip>
            ))}
          </div>
        </div>

        <div>
          <div className={styles.filterLabel}>
            {t('alerts.filters.statusLabel')}
          </div>
          <div className={styles.filterStatusRow}>
            <FilterChip active={resolvedFilter === ''} onClick={() => { setResolvedFilter(''); setPage(1); }}>{t('alerts.filters.all')}</FilterChip>
            <FilterChip active={resolvedFilter === 'false'} onClick={() => { setResolvedFilter('false'); setPage(1); }} color="#ef4444">{t('alerts.filters.unresolved')}</FilterChip>
            <FilterChip active={resolvedFilter === 'true'} onClick={() => { setResolvedFilter('true'); setPage(1); }} color="#22c55e">{t('alerts.filters.resolved')}</FilterChip>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.skeletonItem} />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className={styles.emptyState}>
          <Bell size={40} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>{t('alerts.emptyTitle')}</p>
          <p className={styles.emptyDesc}>{t('alerts.emptyDesc')}</p>
        </div>
      ) : (
        <div className={styles.alertList}>
          {alerts.map((r) => {
            const cfg = typeConfig[r.type as keyof typeof typeConfig] || { icon: <Bell size={16} />, borderColor: '#6b7280' };
            return (
              <div
                key={r.id}
                onClick={() => setSelectedAlert(r)}
                className={styles.alertCard}
                style={{
                  background: r.resolved ? 'var(--color-surface)' : 'var(--color-glass, rgba(18,27,46,0.92))',
                  border: '1px solid var(--color-border-subtle)',
                  borderLeft: `3px solid ${r.resolved ? '#22c55e' : PRIORITY_COLORS[r.priority] || '#6b7280'}`,
                  opacity: r.resolved ? 0.7 : 1,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-hover, #1E2A45)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = r.resolved ? 'var(--color-surface)' : 'var(--color-glass, rgba(18,27,46,0.92))'; }}
              >
                <div className={styles.alertIcon} style={{ color: PRIORITY_COLORS[r.priority] || '#6b7280' }}>
                  {cfg.icon}
                </div>
                <div className={styles.alertContent}>
                  <div className={styles.alertHeader}>
                    <span className={styles.alertTitle}>{r.title}</span>
                    <span className={styles.priorityBadge} style={{ background: `${PRIORITY_COLORS[r.priority] || '#6b7280'}15`, color: PRIORITY_COLORS[r.priority] || '#6b7280' }}>
                      {PRIORITY_LABELS[r.priority] || r.priority}
                    </span>
                    <span className={styles.alertType}>{t(`alerts.type.${r.type}`, r.type)}</span>
                  </div>
                  <div className={styles.alertMessage}>
                    {r.message}
                  </div>
                  <div className={styles.alertMeta}>
                    <span>{formatDateTime(r.createdAt)}</span>
                    {r.delivery && (
                      <Link to={`/deliveries/${r.delivery.id}`} onClick={(e) => e.stopPropagation()} className={styles.deliveryLink}>
                        📦 {r.delivery.title}
                      </Link>
                    )}
                    {r.resolved && <span className={styles.resolvedLabel}>✓ {t('alerts.detail.resolved')}</span>}
                  </div>
                </div>
                <div className={styles.alertActions}>
                  {!r.resolved ? (
                    <button onClick={(e) => { e.stopPropagation(); resolveMutation.mutate({ id: r.id }); }}
                      className={styles.resolveBtn}>
                      {t('alerts.resolveButton')}
                    </button>
                  ) : (
                    <Check size={16} className={styles.checkIcon} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {meta.total > 50 && (
        <div className={styles.pagination}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className={styles.pageBtn}>
            {t('alerts.pagination.previous')}
          </button>
          <span className={styles.pageInfo}>{t('alerts.pagination.page')}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={alerts.length < 50}
            className={styles.pageBtn}>
            {t('alerts.pagination.next')}
          </button>
        </div>
      )}

      {selectedAlert && (
        <>
          <div onClick={() => { setSelectedAlert(null); setResolveComment(''); }} className={styles.overlay} />
          <div className={styles.drawer}>
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.drawerType}>
                  {t(`alerts.type.${selectedAlert.type}`, selectedAlert.type)}
                </div>
                <h2 className={styles.drawerTitle}>{selectedAlert.title}</h2>
              </div>
              <button onClick={() => { setSelectedAlert(null); setResolveComment(''); }} className={styles.closeBtn}><X size={20} /></button>
            </div>

            <div className={styles.badgeRow}>
              <Badge color={PRIORITY_COLORS[selectedAlert.priority]}>{PRIORITY_LABELS[selectedAlert.priority]}</Badge>
              <Badge color={selectedAlert.resolved ? '#22c55e' : '#ef4444'}>{selectedAlert.resolved ? t('alerts.detail.resolved') : t('alerts.detail.active')}</Badge>
            </div>

            <Section label={t('alerts.detail.message')}>{selectedAlert.message}</Section>

            {selectedAlert.delivery && (
              <Section label={t('alerts.detail.delivery')}>
                <Link to={`/deliveries/${selectedAlert.delivery.id}`} className={styles.deliveryLink}>
                  {selectedAlert.delivery.title}
                </Link>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{selectedAlert.delivery.deliveryAddress}</div>
              </Section>
            )}

            {selectedAlert.user && <Section label={t('alerts.detail.driver')}>{selectedAlert.user.firstName} {selectedAlert.user.lastName}</Section>}

            <Section label={t('alerts.detail.date')}>{formatDateTime(selectedAlert.createdAt)}</Section>

            {selectedAlert.link && (
              <Section label={t('alerts.detail.link')}>
                <Link to={selectedAlert.link} className={styles.deliveryLink}>{t('alerts.detail.viewDetail')}</Link>
              </Section>
            )}

            {selectedAlert.resolved && selectedAlert.resolvedBy && (
              <Section label={t('alerts.detail.resolution')}>
                <div>{t('alerts.detail.resolvedBy', { firstName: selectedAlert.resolvedBy.firstName, lastName: selectedAlert.resolvedBy.lastName, date: formatDateTime(selectedAlert.resolvedAt!) })}</div>
                {selectedAlert.resolutionComment && (
                  <div className={styles.resolutionComment}>{selectedAlert.resolutionComment}</div>
                )}
              </Section>
            )}

            {!selectedAlert.resolved && (
              <div className={styles.resolveSection}>
                <div className={styles.resolveSectionTitle}>{t('alerts.detail.markResolved')}</div>
                <textarea placeholder={t('alerts.detail.commentPlaceholder')} value={resolveComment} onChange={(e) => setResolveComment(e.target.value)} rows={3}
                  className={styles.textarea} />
                <button onClick={() => resolveMutation.mutate({ id: selectedAlert.id, comment: resolveComment })} disabled={resolveMutation.isPending}
                  className={styles.confirmBtn}>
                  {resolveMutation.isPending ? t('alerts.detail.resolving') : t('alerts.detail.confirmResolve')}
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
    <div className={styles.kpiCard}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue} style={{ color }}>{value}</div>
      {trend !== null && trend !== undefined && (
        <div className={styles.kpiTrend} style={{ color: trend > 0 ? '#ef4444' : trend < 0 ? '#22c55e' : 'var(--color-text-tertiary)' }}>
          {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : '='}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      <div className={styles.sectionContent}>{children}</div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={styles.badge} style={{ background: `${color}15`, color }}>{children}</span>
  );
}

function FilterChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick} className={styles.filterChip} style={{
      border: active ? `1px solid ${color || 'var(--color-accent, #F2A93C)'}` : '1px solid var(--color-border-subtle)',
      background: active ? `${color || 'var(--color-accent, #F2A93C)'}15` : 'transparent',
      color: active ? (color || 'var(--color-accent, #F2A93C)') : 'var(--color-text-secondary)',
    }}>{children}</button>
  );
}
