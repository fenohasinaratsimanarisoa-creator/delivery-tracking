import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, Trash2, CheckCheck, ArrowRight, Check,
  Package, Fuel, Timer, WifiOff, Wrench, MapPin, Crosshair, Gauge, Info, Clock, ShieldAlert,
} from 'lucide-react';
import { formatDate } from '../services/i18n/formatDate';
import { useNotifications } from '../services/notifications/useNotifications';
import type { Notification } from '../types';
import styles from './NotificationBell.module.css';

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  delivery_status: { icon: <Package size={14} />, color: '#3b82f6' },
  fuel_anomaly: { icon: <Fuel size={14} />, color: '#f59e0b' },
  fuel_gps_coverage_missing: { icon: <Gauge size={14} />, color: '#0ea5e9' },
  maintenance_due: { icon: <Wrench size={14} />, color: '#8b5cf6' },
  speed_alert: { icon: <Gauge size={14} />, color: '#f97316' },
  prolonged_stop: { icon: <Clock size={14} />, color: '#eab308' },
  delay_alert: { icon: <Timer size={14} />, color: '#f43f5e' },
  device_offline: { icon: <WifiOff size={14} />, color: '#ef4444' },
  geofence_event: { icon: <MapPin size={14} />, color: '#14b8a6' },
  location_mismatch: { icon: <Crosshair size={14} />, color: '#8b5cf6' },
  system: { icon: <Info size={14} />, color: '#6b7280' },
};

function typeIcon(type: string) {
  return TYPE_CONFIG[type] ?? { icon: <Bell size={14} />, color: '#6b7280' };
}

function priorityColor(priority: string) {
  switch (priority) {
    case 'critical': return 'var(--color-red)';
    case 'high': return 'var(--color-accent)';
    default: return 'var(--color-teal)';
  }
}

function isSameDay(a: string, b: Date) {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}

function groupLabel(t: (k: string) => string, createdAt: string): string {
  const now = new Date();
  if (isSameDay(createdAt, now)) return t('components.notificationBell.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(createdAt, yesterday)) return t('components.notificationBell.yesterday');
  return formatDate(createdAt);
}

const PANEL_WIDTH = 372;
const PANEL_MAX_HEIGHT = 460;
const MOBILE_BREAKPOINT = 480;

export default function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead, remove, removeAll } = useNotifications({ limit: 20 });
  const [open, setOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevUnread = useRef(unreadCount);

  useEffect(() => {
    if (unreadCount > prevUnread.current && prevUnread.current > 0) {
      const btn = containerRef.current?.querySelector<HTMLButtonElement>('button');
      if (btn) btn.classList.remove(styles.bellRing);
      void btn?.offsetWidth;
      btn?.classList.add(styles.bellRing);
      setTimeout(() => btn?.classList.remove(styles.bellRing), 900);
    }
    prevUnread.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const update = () => {
      setViewportHeight(window.innerHeight);
      const btn = containerRef.current?.querySelector('button');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        setAnchor({ top: rect.bottom + 8, left: rect.right + 8 });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClick);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open]);

  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile ? Math.min(window.innerWidth - 16, 420) : Math.min(PANEL_WIDTH, window.innerWidth - 32);
  const maxHeight = Math.min(PANEL_MAX_HEIGHT, viewportHeight - 32);
  const panelStyle = isMobile
    ? { top: 8, right: 8, width: panelWidth }
    : { top: anchor?.top ?? 60, left: anchor?.left ?? 260, width: panelWidth };

  const groups = useRef(new Map<string, Notification[]>());
  groups.current = new Map();
  for (const n of notifications) {
    const label = groupLabel(t, n.createdAt);
    const arr = groups.current.get(label) ?? [];
    arr.push(n);
    groups.current.set(label, arr);
  }

  function handleItemClick(n: Notification) {
    if (!n.readAt) markRead(n.id);
    if (n.link) navigate(n.link);
  }

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`${styles.bellBtn}${open ? ` ${styles.bellBtnActive}` : ''}`}
        aria-label={unreadCount > 0 ? t('components.notificationBell.unreadCount', { unreadCount }) : t('components.notificationBell.title')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.panel} style={{ ...panelStyle, maxHeight }}>
          <div className={styles.panelGlowLine} />
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleWrap}>
              <span className={styles.panelTitleIcon}><BellRing size={13} /></span>
              <span className={styles.panelTitle}>{t('components.notificationBell.title')}</span>
              {unreadCount > 0 && (
                <span className={styles.unreadChip}>{unreadCount}</span>
              )}
            </div>
            <div className={styles.panelHeaderActions}>
              {notifications.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeAll(); }}
                  className={styles.iconActionBtn}
                  title={t('notificationBell.deleteAllTitle')}
                  aria-label={t('notificationBell.deleteAllTitle')}
                >
                  <Trash2 size={13} />
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); markAllRead(); }}
                  className={`${styles.iconActionBtn} ${styles.markReadBtn}`}
                  title={t('components.notificationBell.markAllRead')}
                  aria-label={t('components.notificationBell.markAllRead')}
                >
                  <CheckCheck size={13} />
                </button>
              )}
            </div>
          </div>

          <div className={styles.list}>
            {notifications.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconWrap}>
                  <BellRing size={26} />
                </div>
                <span className={styles.emptyTitle}>{t('components.notificationBell.emptyTitle')}</span>
                <span className={styles.emptyDesc}>{t('components.notificationBell.empty')}</span>
              </div>
            )}

            {Array.from(groups.current.entries()).map(([label, items]) => (
              <div key={label} className={styles.group}>
                <div className={styles.groupLabel}>{label}</div>
                {items.map((n, i) => {
                  const isUnread = !n.readAt;
                  const cfg = typeIcon(n.type);
                  const pColor = priorityColor(n.priority);
                  return (
                    <div
                      key={n.id}
                      onClick={() => handleItemClick(n)}
                      className={`${styles.notifItem}${isUnread ? ` ${styles.notifItemUnread}` : ''}`}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    >
                      <span className={styles.unreadBar} style={{ background: pColor }} />
                      <div className={styles.itemIconTile} style={{ background: `${cfg.color}1a`, color: cfg.color }}>
                        {cfg.icon}
                      </div>
                      <div className={styles.itemBody}>
                        <div className={styles.itemTitle}>{n.title}</div>
                        <div className={styles.itemMessage}>{n.message}</div>
                        <div className={styles.itemMeta}>
                          <span className={styles.itemTime}>{formatDate(n.createdAt, { hour: '2-digit', minute: '2-digit' })}</span>
                          {n.priority === 'critical' && (
                            <span className={styles.criticalTag}>
                              <ShieldAlert size={10} />
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                        className={styles.itemDeleteBtn}
                        title={t('notificationBell.deleteTitle')}
                        aria-label={t('notificationBell.deleteTitle')}
                      >
                        <Trash2 size={13} />
                      </button>
                      {!isUnread && (
                        <span className={styles.readCheck}><Check size={10} /></span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className={styles.panelFooter}>
            <button
              onClick={() => { navigate('/notifications'); setOpen(false); }}
              className={styles.seeAllBtn}
            >
              {t('components.notificationBell.seeAll')}
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}