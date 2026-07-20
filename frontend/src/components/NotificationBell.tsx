import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import api from '../services/api/client';

interface Notification {
  id: string;
  type: string;
  priority: string;
  title: string;
  message: string;
  link?: string;
  readAt: string | null;
  createdAt: string;
}

function parseToken(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { companyId: payload.companyId, userId: payload.sub || payload.id };
  } catch {
    return { companyId: '', userId: '' };
  }
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const token = localStorage.getItem('accessToken');
  const { companyId, userId } = token ? parseToken(token) : { companyId: '', userId: '' };

  useEffect(() => {
    if (!companyId) return;

    fetchNotifications();

    const socket = io('/notifications', {
      query: { companyId, userId },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('notification', (notif: Notification) => {
      setNotifications((prev) => [notif, ...prev]);
    });

    return () => { socket.close(); };
  }, [companyId, userId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchNotifications() {
    try {
      const res = await api.get('/notifications?limit=20');
      setNotifications(res.data);
    } catch { /* ignore */ }
  }

  async function fetchUnreadCount() {
    try {
      await api.get('/notifications/unread-count');
    } catch { /* ignore */ }
  }

  useEffect(() => {
    fetchUnreadCount();
  }, []);

  async function handleMarkRead(id: string) {
    await api.patch(`/notifications/${id}/read`);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
    );
  }

  async function handleMarkAllRead() {
    await api.patch('/notifications/read-all');
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
  }

  if (!companyId) return null;

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
          fontSize: '1.4rem', padding: '4px 8px', color: '#555',
        }}
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0, background: '#dc3545', color: '#fff',
            borderRadius: '50%', padding: '2px 6px', fontSize: '0.7rem', lineHeight: '1',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', width: '360px', maxHeight: '400px',
          overflowY: 'auto', background: '#fff', border: '1px solid #ddd', borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 1000, marginTop: '4px',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid #eee',
          }}>
            <strong>Notifications</strong>
            {unread > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No notifications</div>
          )}

          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => !n.readAt && handleMarkRead(n.id)}
              style={{
                padding: '12px 16px', borderBottom: '1px solid #f5f5f5',
                cursor: n.readAt ? 'default' : 'pointer',
                background: n.readAt ? '#fff' : '#f0f7ff',
                transition: 'background 0.2s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <strong style={{ fontSize: '0.9rem' }}>{n.title}</strong>
                <span style={{
                  fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px',
                  background:
                    n.priority === 'critical' ? '#dc3545' :
                    n.priority === 'high' ? '#ffc107' : '#e9ecef',
                  color: n.priority === 'high' ? '#000' : '#fff',
                }}>
                  {n.priority}
                </span>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#555' }}>{n.message}</div>
              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '4px' }}>
                {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
