import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { io, Socket } from 'socket.io-client';
import { Bell, Trash2 } from 'lucide-react';
import { formatDateTime } from '../services/i18n/formatDate';
import api from '../services/api/client';
import { getAccessToken } from '../services/auth/tokenStore';
import type { Notification } from '../types';

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

  useEffect(() => {
    if (!token) return;

    fetchNotifications();
    fetchUnreadCount();

    const socket = io('/notifications', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('notification', (notif: Notification) => {
      setNotifications((prev) => [notif, ...prev]);
      setUnreadCount((c) => c + 1);
    });

    return () => { socket.close(); };
  }, [token]);

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

  async function fetchNotifications() {
    try {
      const res = await api.get('/notifications?limit=20');
      setNotifications(res.data);
    } catch { /* ignore */ }
  }

  async function fetchUnreadCount() {
    try {
      const res = await api.get('/notifications/unread-count');
      setUnreadCount(res.data.count ?? 0);
    } catch { /* ignore */ }
  }

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
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          position: 'relative', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: 6,
          color: 'var(--color-text-secondary)',
          borderRadius: 'var(--radius-md)',
          transition: 'background 0.12s, color 0.12s',
        }}
        aria-label={unreadCount > 0 ? t('components.notificationBell.unreadCount', { count: unreadCount }) : t('components.notificationBell.title')}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 1, right: 1,
            background: 'var(--color-red)',
            color: '#fff',
            borderRadius: 'var(--radius-full)',
            padding: '1px 5px',
            fontSize: '0.6rem',
            fontWeight: 700,
            lineHeight: '14px',
            minWidth: 16,
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'fixed',
          top: 'var(--space-lg, 16px)',
          right: isMobile ? 8 : 'var(--space-lg, 16px)',
          width: panelWidth,
          maxHeight: Math.min(PANEL_MAX_HEIGHT, viewportHeight - 32),
          overflowY: 'auto', overflowX: 'hidden',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 1300,
          animation: 'dt-fade-in-up 0.15s ease-out',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-md) var(--space-lg)',
            borderBottom: '1px solid var(--color-border-subtle)',
            position: 'sticky', top: 0,
            background: 'var(--color-surface)',
          }}>
            <span style={{
              fontWeight: 600, fontSize: 'var(--text-sm)',
              color: 'var(--color-text)',
              fontFamily: 'var(--font-display)',
            }}>
              {t('components.notificationBell.title')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm, 8px)' }}>
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

          <div style={{ padding: 'var(--space-xs) 0' }}>
            {notifications.length === 0 && (
              <div style={{
                padding: 'var(--space-xl)',
                textAlign: 'center',
                color: 'var(--color-text-tertiary)',
                fontSize: 'var(--text-sm)',
              }}>
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
                  style={{
                    padding: 'var(--space-md) var(--space-lg)',
                    paddingRight: 'var(--space-sm)',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    cursor: isUnread ? 'pointer' : 'default',
                    background: isUnread ? 'var(--color-accent-muted)' : 'transparent',
                    transition: 'background 0.1s',
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
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 'var(--space-sm)',
                  }}>
                    <div style={{
                      width: 8, height: 8,
                      borderRadius: 'var(--radius-full)',
                      background: pColor,
                      marginTop: 5,
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: isUnread ? 600 : 400,
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text)',
                        marginBottom: 2,
                      }}>
                        {n.title}
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-secondary)',
                        lineHeight: 1.4,
                      }}>
                        {n.message}
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--color-text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                        marginTop: 'var(--space-xs)',
                      }}>
                        {formatDateTime(n.createdAt)}
                      </div>
                    </div>
                    <button
                      data-del
                      onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                      style={{
                        background: 'none', border: 'none',
                        cursor: 'pointer', padding: 4,
                        color: 'var(--color-text-tertiary)',
                        borderRadius: 'var(--radius-sm)',
                        opacity: 0, flexShrink: 0,
                        transition: 'opacity 0.15s ease, color 0.15s ease, background 0.15s ease',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
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