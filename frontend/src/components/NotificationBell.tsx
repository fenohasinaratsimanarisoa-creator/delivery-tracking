import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { io, Socket } from 'socket.io-client';
import { useQuery } from '@tanstack/react-query';
import { Bell, Trash2 } from 'lucide-react';
import { formatDateTime } from '../services/i18n/formatDate';
import api from '../services/api/client';
import { getAccessToken } from '../services/auth/tokenStore';
import type { Notification } from '../types';
import styles from './NotificationBell.module.css';

function getPriorityColor(priority: string) {
  switch (priority) {
    case 'critical': return 'var(--color-red)';
    case 'high': return 'var(--color-accent)';
    default: return 'var(--color-teal)';
  }
}

const PANEL_WIDTH = 360;
const PANEL_MAX_HEIGHT = 420;
const MOBILE_BREAKPOINT = 480;

export default function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  const socketRef = useRef<Socket | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const token = getAccessToken();

  const { data: notifData, refetch: refetchNotifs } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get('/notifications?limit=20').then((r) => r.data),
    enabled: !!token,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: unreadData, refetch: refetchUnread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get('/notifications/unread-count').then((r) => r.data),
    enabled: !!token,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (notifData) setNotifications(notifData);
  }, [notifData]);

  useEffect(() => {
    if (unreadData) setUnreadCount(unreadData.count ?? 0);
  }, [unreadData]);

  useEffect(() => {
    if (!token) return;

    const socket = io('/notifications', {
      auth: (cb) => cb({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('notification', () => {
      refetchNotifs();
      refetchUnread();
    });

    return () => { socket.close(); };
  }, [token, refetchNotifs, refetchUnread]);

  useEffect(() => {
    if (!open) return;

    const update = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  async function handleMarkRead(id: string) {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
    } catch { /* ignore */ }
  }

  async function handleMarkAllRead() {
    try {
      await api.patch('/notifications/read-all');
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  }

  async function handleDelete(id: string) {
    try {
      await api.delete(`/notifications/${id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      const removed = notifications.find((n) => n.id === id);
      if (removed && !removed.readAt) setUnreadCount((c) => Math.max(0, c - 1));
    } catch { /* ignore */ }
  }

  async function handleDeleteAll() {
    try {
      await api.delete('/notifications');
      setNotifications([]);
      setUnreadCount(0);
    } catch { /* ignore */ }
  }

  if (!token) return null;

  const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
  const panelWidth = isMobile ? Math.min(window.innerWidth - 16, 400) : Math.min(PANEL_WIDTH, window.innerWidth - 32);

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={styles.bellBtn}
        aria-label={unreadCount > 0 ? t('components.notificationBell.unreadCount', { count: unreadCount }) : t('components.notificationBell.title')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className={styles.badge}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={`notif-panel ${styles.panel}`} style={{
          position: 'fixed',
          top: 'var(--space-lg, 16px)',
          right: isMobile ? 8 : 'var(--space-lg, 16px)',
          width: panelWidth,
          maxHeight: Math.min(PANEL_MAX_HEIGHT, viewportHeight - 32),
          zIndex: 1300,
          animation: 'dt-fade-in-up 0.15s ease-out',
        }}>
          <div className={styles.panelHeader}
            style={{ position: 'sticky', top: 0, background: 'var(--color-surface)' }}>
            <span className={styles.panelTitle}>
              {t('components.notificationBell.title')}
            </span>
            <div className={styles.panelHeaderActions}>
              {notifications.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteAll(); }}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)', fontWeight: 500,
                    fontFamily: 'var(--font-body)',
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '2px 4px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'color var(--transition-fast, 150ms) ease, background var(--transition-fast, 150ms) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-red)'; e.currentTarget.style.background = 'var(--color-red-muted)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                  title={t('notificationBell.deleteAllTitle')}
                >
                  <Trash2 size={12} />
                  {t('notificationBell.deleteAll')}
                </button>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--color-accent)', cursor: 'pointer',
                    fontSize: 'var(--text-xs)', fontWeight: 500,
                    fontFamily: 'var(--font-body)',
                    padding: '2px 4px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'background var(--transition-fast, 150ms) ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-accent-muted)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {t('components.notificationBell.markAllRead')}
                </button>
              )}
            </div>
          </div>

          <div className={styles.list}>
            {notifications.length === 0 && (
              <div className={styles.emptyState}>
                {t('components.notificationBell.empty')}
              </div>
            )}
            {notifications.map((n) => {
              const isUnread = !n.readAt;
              const pColor = getPriorityColor(n.priority);
              return (
                <div
                  key={n.id}
                  onClick={() => { if (isUnread) handleMarkRead(n.id); }}
                  className={styles.notifItem}
                  style={{
                    cursor: isUnread ? 'pointer' : 'default',
                    background: isUnread ? 'var(--color-accent-muted)' : 'transparent',
                    opacity: isUnread ? 1 : 0.6,
                  }}
                  onMouseEnter={(e) => {
                    const del = e.currentTarget.querySelector('[data-del]') as HTMLElement;
                    if (del) del.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    const del = e.currentTarget.querySelector('[data-del]') as HTMLElement;
                    if (del) del.style.opacity = '0';
                  }}
                >
                  <div className={styles.notifContentRow}>
                    <div className={styles.priorityDot} style={{ background: pColor }} />
                    <div className={styles.notifTextWrap}>
                      <div className={styles.notifTitle}
                        style={{ fontWeight: isUnread ? 600 : 400 }}>
                        {n.title}
                      </div>
                      <div className={styles.notifMessage}>
                        {n.message}
                      </div>
                      <div className={styles.notifTime}>
                        {formatDateTime(n.createdAt)}
                      </div>
                    </div>
                    <button
                      data-del
                      onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                      className={styles.deleteBtn}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-red)'; e.currentTarget.style.background = 'var(--color-red-muted)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}
                      title={t('notificationBell.deleteTitle')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}