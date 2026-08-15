import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell,
  BellRing,
  X,
  Check,
  CheckCheck,
  Clock,
  MapPin,
  Gauge,
  Fuel,
  WifiOff,
  Timer,
  Crosshair,
  AlertTriangle,
  TrendingUp,
  Layers,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  ArrowUpRight,
  ArrowDownRight,
  Package,
} from 'lucide-react';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../services/i18n/formatDate';
import { useNotificationSocket } from '../services/notifications/notificationsSocket';
import { useAuth } from '../hooks/AuthContext';

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

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--color-red)',
  high: 'var(--color-orange)',
  medium: 'var(--color-warning)',
  low: 'var(--color-teal)',
};
const PERIOD_VALUES = ['today', '7d', '30d', 'all'] as const;

export default function AlertsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  // Un driver consulte ses propres alertes en lecture seule (liste filtrée
  // côté backend) : pas de KPIs/stats ni de résolution, réservés au dispatch.
  const isDriver = user?.role === 'driver';
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
    enabled: !isDriver,
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
    if (!selectedAlert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedAlert(null);
        setResolveComment('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAlert]);

  const { connected: liveConnected } = useNotificationSocket(() => {
    setLiveCount((c) => c + 1);
    queryClient.invalidateQueries({ queryKey: ['alerts'] });
    queryClient.invalidateQueries({ queryKey: ['alerts-stats'] });
  });

  const alerts: AlertItem[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0 };
  const alertStats: AlertStats | undefined = stats;

  const toggleType = (t: string) => { setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]); setPage(1); };
  const togglePriority = (p: string) => { setSelectedPriorities((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]); setPage(1); };

  const resetFilters = () => {
    setSelectedTypes([]);
    setSelectedPriorities([]);
    setResolvedFilter('false');
    setPeriod('7d');
    setPage(1);
  };

  const hasActiveFilters =
    selectedTypes.length > 0 ||
    selectedPriorities.length > 0 ||
    resolvedFilter !== 'false' ||
    period !== '7d';

  const typeConfig = useMemo(() => ({
    speed_alert: { icon: <Gauge size={17} />, color: 'var(--color-orange)' },
    prolonged_stop: { icon: <Clock size={17} />, color: 'var(--color-warning)' },
    delay_alert: { icon: <Timer size={17} />, color: 'var(--color-blue)' },
    device_offline: { icon: <WifiOff size={17} />, color: 'var(--color-red)' },
    geofence_event: { icon: <MapPin size={17} />, color: 'var(--color-cyan)' },
    location_mismatch: { icon: <Crosshair size={17} />, color: 'var(--color-purple)' },
    fuel_anomaly: { icon: <Fuel size={17} />, color: 'var(--color-warning)' },
  }), []);

  const PRIORITY_ICONS: Record<string, React.ReactNode> = {
    critical: <AlertTriangle size={16} />,
    high: <TrendingUp size={16} />,
    medium: <Clock size={16} />,
    low: <CheckCheck size={16} />,
  };

  const trendPercent = useMemo(() => {
    if (!alertStats?.prevTotal || alertStats.prevTotal === 0) return null;
    return Math.round(((alertStats.total - alertStats.prevTotal) / alertStats.prevTotal) * 100);
  }, [alertStats]);

  const allTypes = ['speed_alert', 'prolonged_stop', 'delay_alert', 'device_offline', 'geofence_event', 'location_mismatch', 'fuel_anomaly'];
  const allPriorities = ['critical', 'high', 'medium', 'low'];

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}>
              <BellRing size={19} />
            </div>
            <h1 className={styles.pageTitle}>{t('alerts.title')}</h1>
            {alertStats && alertStats.total > 0 && (
              <span className={styles.unresolvedPill}>
                <span className={styles.pillDot} />
                {t('alerts.unresolvedCount', { count: alertStats.total })}
              </span>
            )}
          </div>
          <p className={styles.pageSubtitle}>{t('alerts.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          {!isDriver && liveConnected && (
            <span className={styles.livePill}>
              <span className={styles.livePulseDot} />
              {t('alerts.live')}
            </span>
          )}
          {!isDriver && liveCount > 0 && (
            <span className={styles.newCountPill}>
              {t('alerts.liveNew', { count: liveCount })}
            </span>
          )}
        </div>
      </div>

      {!isDriver && alertStats && (
        <div className={styles.kpiGrid}>
          <KpiCard
            icon={<BellRing size={16} />}
            label={t('alerts.kpiUnresolved')}
            value={alertStats.total}
            color="var(--color-red)"
            trend={trendPercent}
          />
          {allPriorities.map((prio) => {
            const count = alertStats.byPriority.find((p) => p.priority === prio)?._count ?? 0;
            if (count === 0) return null;
            return (
              <KpiCard
                key={prio}
                icon={PRIORITY_ICONS[prio]}
                label={PRIORITY_LABELS[prio]}
                value={count}
                color={PRIORITY_COLORS[prio]}
              />
            );
          })}
          {alertStats.byType.length > 0 && (
            <KpiCard
              icon={<Layers size={16} />}
              label={t('alerts.kpiTypes')}
              value={alertStats.byType.length}
              color="var(--color-blue)"
            />
          )}
        </div>
      )}

      {!isDriver && (
        <div className={styles.filtersPanel}>
          <div className={styles.filtersHeader}>
            <div className={styles.filtersTitle}>{t('alerts.filters.title')}</div>
          {hasActiveFilters && (
            <button onClick={resetFilters} className={styles.resetBtn}>
              <RotateCcw size={13} />
              {t('alerts.filters.reset')}
            </button>
          )}
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('alerts.filters.periodLabel')}</div>
          <div className={styles.filterChipsRow}>
            {PERIOD_VALUES.map((val) => (
              <FilterChip key={val} active={period === val} onClick={() => { setPeriod(val); setPage(1); }}>{PERIOD_LABELS[val]}</FilterChip>
            ))}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('alerts.filters.typeLabel')}</div>
          <div className={styles.filterChipsRow}>
            {allTypes.map((tp) => {
              const cfg = typeConfig[tp as keyof typeof typeConfig];
              const count = alertStats?.byType.find((bt) => bt.type === tp)?._count;
              return (
                <FilterChip key={tp} active={selectedTypes.includes(tp)} onClick={() => toggleType(tp)} color={cfg?.color} count={count}>
                  {t(`alerts.type.${tp}`, tp)}
                </FilterChip>
              );
            })}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('alerts.filters.priorityLabel')}</div>
          <div className={styles.filterChipsRow}>
            {allPriorities.map((prio) => {
              const count = alertStats?.byPriority.find((bp) => bp.priority === prio)?._count;
              return (
                <FilterChip key={prio} active={selectedPriorities.includes(prio)} onClick={() => togglePriority(prio)} color={PRIORITY_COLORS[prio]} count={count}>
                  {PRIORITY_LABELS[prio]}
                </FilterChip>
              );
            })}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('alerts.filters.statusLabel')}</div>
          <div className={styles.filterChipsRow}>
            <FilterChip active={resolvedFilter === ''} onClick={() => { setResolvedFilter(''); setPage(1); }}>{t('alerts.filters.all')}</FilterChip>
            <FilterChip active={resolvedFilter === 'false'} onClick={() => { setResolvedFilter('false'); setPage(1); }} color="var(--color-red)">{t('alerts.filters.unresolved')}</FilterChip>
            <FilterChip active={resolvedFilter === 'true'} onClick={() => { setResolvedFilter('true'); setPage(1); }} color="var(--color-teal)">{t('alerts.filters.resolved')}</FilterChip>
          </div>
        </div>
      </div>
      )}

      {isLoading ? (
        <div className={styles.loadingContainer}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.skeletonCard} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIconWrap}>
            <Bell size={34} className={styles.emptyIcon} />
          </div>
          <p className={styles.emptyTitle}>{t('alerts.emptyTitle')}</p>
          <p className={styles.emptyDesc}>{t('alerts.emptyDesc')}</p>
        </div>
      ) : (
        <div className={styles.alertList}>
          {alerts.map((r, i) => {
            const cfg = typeConfig[r.type as keyof typeof typeConfig] || { icon: <Bell size={17} />, color: 'var(--color-text-tertiary)' };
            const prio = PRIORITY_COLORS[r.priority] || 'var(--color-text-tertiary)';
            const cardStyle = { '--prio': r.resolved ? 'var(--color-teal)' : prio, animationDelay: `${Math.min(i, 10) * 45}ms` } as CSSProperties;
            return (
              <div
                key={r.id}
                onClick={() => setSelectedAlert(r)}
                className={`${styles.alertCard}${r.resolved ? ` ${styles.alertCardResolved}` : ''}`}
                style={cardStyle}
              >
                <div className={styles.alertIconChip} style={{ background: `${prio}1a`, color: prio }}>
                  {cfg.icon}
                </div>
                <div className={styles.alertContent}>
                  <div className={styles.alertHeader}>
                    <span className={styles.alertTitle}>{r.title}</span>
                    <span className={styles.alertType}>
                      <span className={styles.alertTypeDot} style={{ background: cfg.color }} />
                      {t(`alerts.type.${r.type}`, r.type)}
                    </span>
                  </div>
                  <div className={styles.alertMessage}>{r.message}</div>
                  <div className={styles.alertMeta}>
                    <span className={styles.metaTime}>{formatDateTime(r.createdAt)}</span>
                    {r.delivery && (
                      <Link to={`/deliveries/${r.delivery.id}`} onClick={(e) => e.stopPropagation()} className={styles.deliveryChip}>
                        <Package size={14} /> {r.delivery.title}
                      </Link>
                    )}
                    {r.resolved ? (
                      <span className={styles.resolvedStamp}>
                        <CheckCheck size={12} />
                        {t('alerts.detail.resolved')}
                      </span>
                    ) : (
                      <span className={styles.activePulse} title={t('alerts.detail.active')} />
                    )}
                  </div>
                </div>
                <div className={styles.alertActions}>
                  {!r.resolved && !isDriver ? (
                    <button onClick={(e) => { e.stopPropagation(); resolveMutation.mutate({ id: r.id }); }}
                      className={styles.resolveBtn}>
                      <Check size={13} />
                      {t('alerts.resolveButton')}
                    </button>
                  ) : (
                    r.resolved && <span className={styles.checkSeal}><Check size={14} /></span>
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
            <ChevronLeft size={15} />
            {t('alerts.pagination.previous')}
          </button>
          <span className={styles.pageInfo}>{t('alerts.pagination.page', { page })}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={alerts.length < 50}
            className={styles.pageBtn}>
            {t('alerts.pagination.next')}
            <ChevronRight size={15} />
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
              <button onClick={() => { setSelectedAlert(null); setResolveComment(''); }} className={styles.closeBtn} aria-label="Close"><X size={20} /></button>
            </div>

            <div className={styles.badgeRow}>
              <Badge color={PRIORITY_COLORS[selectedAlert.priority]}>{PRIORITY_LABELS[selectedAlert.priority]}</Badge>
              <Badge color={selectedAlert.resolved ? 'var(--color-teal)' : 'var(--color-red)'}>{selectedAlert.resolved ? t('alerts.detail.resolved') : t('alerts.detail.active')}</Badge>
            </div>

            <Section label={t('alerts.detail.message')}>{selectedAlert.message}</Section>

            {selectedAlert.delivery && (
              <Section label={t('alerts.detail.delivery')}>
                <Link to={`/deliveries/${selectedAlert.delivery.id}`} className={styles.deliveryLink}>
                  {selectedAlert.delivery.title}
                </Link>
                <div className={styles.sectionMuted}>{selectedAlert.delivery.deliveryAddress}</div>
              </Section>
            )}

            {selectedAlert.user && <Section label={t('alerts.detail.driver')}>{selectedAlert.user.firstName} {selectedAlert.user.lastName}</Section>}

            <Section label={t('alerts.detail.date')}>
              <span className={styles.monoTime}>{formatDateTime(selectedAlert.createdAt)}</span>
            </Section>

            {selectedAlert.link && (
              <Section label={t('alerts.detail.link')}>
                <Link to={selectedAlert.link} className={styles.deliveryLink}>{t('alerts.detail.viewDetail')}</Link>
              </Section>
            )}

            {selectedAlert.resolved && selectedAlert.resolvedBy && (
              <Section label={t('alerts.detail.resolution')}>
                <div className={styles.sectionMuted}>{t('alerts.detail.resolvedBy', { firstName: selectedAlert.resolvedBy.firstName, lastName: selectedAlert.resolvedBy.lastName, date: formatDateTime(selectedAlert.resolvedAt!) })}</div>
                {selectedAlert.resolutionComment && (
                  <div className={styles.resolutionComment}>{selectedAlert.resolutionComment}</div>
                )}
              </Section>
            )}

            {!selectedAlert.resolved && !isDriver && (
              <div className={styles.resolveSection}>
                <div className={styles.resolveSectionTitle}>{t('alerts.detail.markResolved')}</div>
                <textarea placeholder={t('alerts.detail.commentPlaceholder')} value={resolveComment} onChange={(e) => setResolveComment(e.target.value)} rows={3}
                  className={styles.textarea} />
                <button onClick={() => resolveMutation.mutate({ id: selectedAlert.id, comment: resolveComment })} disabled={resolveMutation.isPending}
                  className={styles.confirmBtn}>
                  <Check size={14} />
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

function useCountUp(target: number, duration = 650) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function KpiCard({ label, value, color, trend, icon }: { label: string; value: number; color: string; trend?: number | null; icon?: React.ReactNode }) {
  const animatedValue = useCountUp(value);
  // --kpi-muted via color-mix() (et non `${color}1a`) pour fonctionner avec une var() CSS.
  const cardStyle = { '--kpi': color, '--kpi-muted': `color-mix(in srgb, ${color} 10%, transparent)` } as CSSProperties;
  return (
    <div className={styles.kpiCard} style={cardStyle}>
      <div className={styles.kpiTop}>
        <div className={styles.kpiIcon}>{icon}</div>
        {trend !== null && trend !== undefined && (
          <span className={styles.kpiTrend} style={{ color: trend > 0 ? 'var(--color-red)' : trend < 0 ? 'var(--color-teal)' : 'var(--color-text-tertiary)' }}>
            {trend > 0 ? <ArrowUpRight size={12} /> : trend < 0 ? <ArrowDownRight size={12} /> : null}
            {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : '='}
          </span>
        )}
      </div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{animatedValue}</div>
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
  // color-mix() pour les fonds/bordures teintés : compatible avec une var() CSS
  // (le `${color}1a` historique ne l'est pas).
  return (
    <span className={styles.badge} style={{
      background: `color-mix(in srgb, ${color} 10%, transparent)`,
      color,
      boxShadow: `0 0 0 1px color-mix(in srgb, ${color} 19%, transparent), 0 0 14px color-mix(in srgb, ${color} 13%, transparent)`,
    }}>{children}</span>
  );
}

function FilterChip({ active, onClick, children, color, count }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string; count?: number }) {
  const chipStyle = { '--chip': color || 'var(--color-accent)' } as CSSProperties;
  return (
    <button
      onClick={onClick}
      className={`${styles.filterChip}${active ? ` ${styles.filterChipActive}` : ''}`}
      style={chipStyle}
    >
      {color && <span className={styles.chipDot} />}
      {children}
      {count !== undefined && count > 0 && <span className={styles.chipCount}>{count}</span>}
    </button>
  );
}
