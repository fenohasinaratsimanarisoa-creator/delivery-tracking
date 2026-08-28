import { useState, useMemo, useEffect, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Check, CheckCheck, Trash2, ArrowLeft, RotateCcw,
  ShieldAlert, Clock, Filter,
  Package, Fuel, Gauge, WifiOff, Wrench, MapPin, Crosshair, Info,
} from 'lucide-react';
import { formatDateTime } from '../../services/i18n/formatDate';
import { useNotifications } from '../../services/notifications/useNotifications';
import { useToast } from '../../components/Toast';
import type { Notification } from '../../types';
import styles from './NotificationsPage.module.css';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  delivery_status: { icon: <Package size={15} />, color: '#3b82f6' },
  fuel_anomaly: { icon: <Fuel size={15} />, color: '#f59e0b' },
  fuel_gps_coverage_missing: { icon: <Gauge size={15} />, color: '#0ea5e9' },
  maintenance_due: { icon: <Wrench size={15} />, color: '#8b5cf6' },
  speed_alert: { icon: <Gauge size={15} />, color: '#f97316' },
  prolonged_stop: { icon: <Clock size={15} />, color: '#eab308' },
  delay_alert: { icon: <Clock size={15} />, color: '#f43f5e' },
  device_offline: { icon: <WifiOff size={15} />, color: '#ef4444' },
  geofence_event: { icon: <MapPin size={15} />, color: '#14b8a6' },
  location_mismatch: { icon: <Crosshair size={15} />, color: '#8b5cf6' },
  system: { icon: <Info size={15} />, color: '#6b7280' },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
};

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'] as const;

function typeIcon(type: string) {
  return TYPE_CONFIG[type] ?? { icon: <Bell size={15} />, color: '#6b7280' };
}

function isSameDay(a: string, b: Date) {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    notifications, unreadCount, connected, isLoading,
    markRead, markAllRead, remove, removeAll,
  } = useNotifications({ limit: 250 });

  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const PRIORITY_LABELS: Record<string, string> = {
    critical: t('notificationsPage.priority.critical'),
    high: t('notificationsPage.priority.high'),
    medium: t('notificationsPage.priority.medium'),
    low: t('notificationsPage.priority.low'),
  };

  const ALL_TYPES = Object.keys(TYPE_CONFIG);

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (statusFilter === 'unread' && n.readAt) return false;
      if (statusFilter === 'read' && !n.readAt) return false;
      if (priorityFilter !== 'all' && n.priority !== priorityFilter) return false;
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, statusFilter, priorityFilter, typeFilter]);

  const locale = i18n.language === 'en' ? 'en-US' : 'fr-FR';

  const grouped = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of filtered) {
      const now = new Date();
      let label: string;
      if (isSameDay(n.createdAt, now)) label = t('notificationsPage.group.today');
      else if (isSameDay(n.createdAt, startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)))) {
        label = t('notificationsPage.group.yesterday');
      } else {
        const d = new Date(n.createdAt);
        const todayStart = startOfDay(new Date());
        const target = startOfDay(d);
        const diffDays = Math.round((todayStart.getTime() - target.getTime()) / 86400000);
        label = diffDays <= 7
          ? t('notificationsPage.group.thisWeek')
          : d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
      }
      const arr = map.get(label) ?? [];
      arr.push(n);
      map.set(label, arr);
    }
    return Array.from(map.entries());
  }, [filtered, t, locale]);

  const todayCount = useMemo(() => notifications.filter((n) => isSameDay(n.createdAt, new Date())).length, [notifications]);
  const urgentCount = useMemo(
    () => notifications.filter((n) => !n.readAt && (n.priority === 'critical' || n.priority === 'high')).length,
    [notifications],
  );

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' || typeFilter !== 'all';
  const resetFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
    setTypeFilter('all');
  };

  function handleClick(n: Notification) {
    if (!n.readAt) markRead(n.id);
    if (n.link) navigate(n.link);
  }

  function handleMarkAllRead() {
    markAllRead();
    toast(t('notificationsPage.toast.markedRead'), 'success');
  }

  function handleDeleteAll() {
    removeAll();
    toast(t('notificationsPage.toast.deletedAll'), 'success');
  }

  function handleDelete(id: string) {
    remove(id);
    toast(t('notificationsPage.toast.deleted'));
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}>
              <BellRing size={19} />
            </div>
            <h1 className={styles.pageTitle}>{t('notificationsPage.title')}</h1>
            {unreadCount > 0 && (
              <span className={styles.unresolvedPill}>
                <span className={styles.pillDot} />
                {t('notificationsPage.unreadCount', { count: unreadCount })}
              </span>
            )}
          </div>
          <p className={styles.pageSubtitle}>{t('notificationsPage.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          {notifications.length > 0 && (
            <>
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} className={`${styles.bulkBtn} ${styles.bulkMarkRead}`}>
                  <CheckCheck size={13} />
                  {t('notificationsPage.markAllRead')}
                </button>
              )}
              <button onClick={handleDeleteAll} className={`${styles.bulkBtn} ${styles.bulkDelete}`}>
                <Trash2 size={13} />
                {t('notificationsPage.clearAll')}
              </button>
            </>
          )}
          <button onClick={() => navigate('/dashboard')} className={styles.backBtn}>
            <ArrowLeft size={13} />
            {t('notificationsPage.backToDashboard')}
          </button>
          {connected && (
            <span className={styles.livePill}>
              <span className={styles.livePulseDot} />
              {t('notificationsPage.live')}
            </span>
          )}
        </div>
      </div>

      <div className={styles.kpiGrid}>
        <KpiCard
          icon={<BellRing size={16} />}
          label={t('notificationsPage.kpi.unread')}
          value={unreadCount}
          color="#ef4444"
        />
        <KpiCard
          icon={<Bell size={16} />}
          label={t('notificationsPage.kpi.total')}
          value={notifications.length}
          color="var(--color-accent)"
        />
        <KpiCard
          icon={<ShieldAlert size={16} />}
          label={t('notificationsPage.kpi.urgent')}
          value={urgentCount}
          color="#f97316"
        />
        <KpiCard
          icon={<Clock size={16} />}
          label={t('notificationsPage.kpi.today')}
          value={todayCount}
          color="#3b82f6"
        />
      </div>

      <div className={styles.filtersPanel}>
        <div className={styles.filtersHeader}>
          <div className={styles.filtersTitle}>
            <Filter size={13} />
            {t('notificationsPage.filters.title')}
          </div>
          {hasActiveFilters && (
            <button onClick={resetFilters} className={styles.resetBtn}>
              <RotateCcw size={13} />
              {t('notificationsPage.filters.reset')}
            </button>
          )}
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('notificationsPage.filters.status')}</div>
          <div className={styles.filterChipsRow}>
            {(['all', 'unread', 'read'] as const).map((val) => (
              <FilterChip key={val} active={statusFilter === val} onClick={() => setStatusFilter(val)} color={val === 'unread' ? '#ef4444' : val === 'read' ? '#22c55e' : undefined}>
                {val === 'all' ? t('notificationsPage.filters.all') : val === 'unread' ? t('notificationsPage.filters.unread') : t('notificationsPage.filters.read')}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('notificationsPage.filters.priority')}</div>
          <div className={styles.filterChipsRow}>
            <FilterChip active={priorityFilter === 'all'} onClick={() => setPriorityFilter('all')}>{t('notificationsPage.filters.all')}</FilterChip>
            {PRIORITY_ORDER.map((p) => (
              <FilterChip key={p} active={priorityFilter === p} onClick={() => setPriorityFilter(p)} color={PRIORITY_COLORS[p]}>
                {PRIORITY_LABELS[p]}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className={styles.filterBlock}>
          <div className={styles.filterLabel}>{t('notificationsPage.filters.type')}</div>
          <select
            className={styles.typeSelect}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">{t('notificationsPage.filters.allTypes')}</option>
            {ALL_TYPES.map((tp) => (
              <option key={tp} value={tp}>{t(`notificationsPage.type.${tp}`, tp)}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className={styles.loadingContainer}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.skeletonCard} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIconWrap}>
            <Bell size={34} className={styles.emptyIcon} />
          </div>
          <p className={styles.emptyTitle}>
            {notifications.length === 0 ? t('notificationsPage.empty.title') : t('notificationsPage.empty.filteredTitle')}
          </p>
          <p className={styles.emptyDesc}>
            {notifications.length === 0 ? t('notificationsPage.empty.desc') : t('notificationsPage.empty.filteredDesc')}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {grouped.map(([label, items]) => (
            <div key={label} className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupLabel}>{label}</span>
                <span className={styles.groupCount}>{items.length}</span>
              </div>
              {items.map((n) => {
                const isUnread = !n.readAt;
                const cfg = typeIcon(n.type);
                const prio = PRIORITY_COLORS[n.priority] || '#6b7280';
                const cardStyle = {
                  '--prio': prio,
                  borderLeftColor: isUnread ? prio : 'transparent',
                } as CSSProperties;
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`${styles.notifCard}${isUnread ? ` ${styles.notifCardUnread}` : ''}`}
                    style={cardStyle}
                  >
                    <div className={styles.notifIconChip} style={{ background: `${cfg.color}1a`, color: cfg.color }}>
                      {cfg.icon}
                    </div>
                    <div className={styles.notifContent}>
                      <div className={styles.notifHeader}>
                        <span className={styles.notifTitle}>{n.title}</span>
                        <span className={styles.priorityChip} style={{ background: `${prio}1a`, color: prio }}>
                          {n.priority === 'critical' && <ShieldAlert size={11} />}
                          {PRIORITY_LABELS[n.priority] ?? n.priority}
                        </span>
                      </div>
                      <div className={styles.notifMessage}>{n.message}</div>
                      <div className={styles.notifMeta}>
                        <span className={styles.metaTime}>{formatDateTime(n.createdAt)}</span>
                        <span className={styles.metaType}>
                          <span className={styles.metaTypeDot} style={{ background: cfg.color }} />
                          {t(`notificationsPage.type.${n.type}`, n.type)}
                        </span>
                        {n.link && (
                          <span className={styles.linkHint}><Check size={10} />{t('notificationsPage.related')}</span>
                        )}
                      </div>
                    </div>
                    <div className={styles.notifActions}>
                      {isUnread ? (
                        <button onClick={(e) => { e.stopPropagation(); markRead(n.id); }} className={styles.markReadBtn} title={t('notificationsPage.markRead')}>
                          <Check size={13} />
                        </button>
                      ) : (
                        <span className={styles.checkSeal} title={t('notificationsPage.read')}><Check size={14} /></span>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }} className={styles.deleteBtn} title={t('notificationsPage.delete')}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function useCountUp(target: number, duration = 650) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
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

function KpiCard({ label, value, color, icon }: { label: string; value: number; color: string; icon?: React.ReactNode }) {
  const animated = useCountUp(value);
  const cardStyle = { '--kpi': color, '--kpi-muted': `${color}1a` } as CSSProperties;
  return (
    <div className={styles.kpiCard} style={cardStyle}>
      <div className={styles.kpiIcon}>{icon}</div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{animated}</div>
    </div>
  );
}

function FilterChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const chipStyle = { '--chip': color || 'var(--color-accent)' } as CSSProperties;
  return (
    <button onClick={onClick} className={`${styles.filterChip}${active ? ` ${styles.filterChipActive}` : ''}`} style={chipStyle}>
      {color && <span className={styles.chipDot} />}
      {children}
    </button>
  );
}
