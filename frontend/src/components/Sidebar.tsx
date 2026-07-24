import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { getMenuItemsForRole } from './menuItems';
import { useAuth } from '../hooks/AuthContext';
import NotificationBell from './NotificationBell';
import TrackingStatusIndicator from './TrackingStatusIndicator';
import { useTrackingStatus } from '../services/tracking/TrackingContext';

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 60;
const MOBILE_BREAKPOINT = 768;

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      if (!mobile) setMobileOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const role = user?.role ?? 'admin';
  const trackingStatus = useTrackingStatus();
  const items = getMenuItemsForRole(role);

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const s = (collapsed && !isMobile);

  const sidebarContent = (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      width: s ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      background: 'var(--color-bg)',
      borderRight: '1px solid var(--color-border)',
      transition: 'width 0.2s ease',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: s ? 'center' : 'space-between',
        padding: s ? 'var(--space-lg) 0' : 'var(--space-lg) var(--space-lg)',
        borderBottom: '1px solid var(--color-border-subtle)',
        minHeight: 56,
      }}>
        {!s && (
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 'var(--text-lg)', color: 'var(--color-accent)',
            whiteSpace: 'nowrap', letterSpacing: '-0.02em',
          }}>
            LogiTrack
          </span>
        )}
        {s && (
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 700,
            fontSize: 'var(--text-xl)', color: 'var(--color-accent)',
          }}>
            L
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer', padding: 4, borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24,
            }}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-secondary)',
              cursor: 'pointer', padding: 4, display: 'flex',
            }}
            aria-label={t('nav.closeMenu')}
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Notification bell in sidebar header area for expanded */}
      {!s && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          padding: 'var(--space-xs) var(--space-lg)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <NotificationBell />
        </div>
      )}

      {/* Navigation */}
      <nav style={{
        flex: 1, overflowY: 'auto', padding: 'var(--space-sm) 0',
        scrollbarWidth: 'thin',
      }}>
        {items.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <div
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: s ? 'var(--space-md) 0' : 'var(--space-sm) var(--space-lg)',
                cursor: 'pointer', whiteSpace: 'nowrap', position: 'relative',
                background: active ? 'var(--color-accent-muted)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                transition: 'background 0.12s, color 0.12s',
                margin: s ? 'var(--space-xs) auto' : 'var(--space-xs) var(--space-sm)',
                width: s ? 40 : 'auto',
                borderRadius: 'var(--radius-md)',
                justifyContent: s ? 'center' : 'flex-start',
              }}
              onMouseEnter={(e) => {
                if (collapsed && !isMobile) {
                  tooltipTimer.current = setTimeout(() => {
                    const tip = e.currentTarget.querySelector('[data-tooltip]') as HTMLElement;
                    if (tip) tip.style.opacity = '1';
                  }, 300);
                }
              }}
              onMouseLeave={() => {
                clearTimeout(tooltipTimer.current);
                const tips = document.querySelectorAll('[data-tooltip]');
                tips.forEach((t) => (t as HTMLElement).style.opacity = '0');
              }}
            >
              <div style={{
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                width: 20, height: 20,
              }}>
                <Icon size={18} />
              </div>
              {!s && (
                <span style={{
                  fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 400,
                  fontFamily: 'var(--font-body)',
                }}>
                  {item.label}
                </span>
              )}
              {s && (
                <div
                  data-tooltip
                  style={{
                    position: 'fixed', left: SIDEBAR_COLLAPSED + 8, opacity: 0,
                    background: 'var(--color-surface)', color: 'var(--color-text)',
                    padding: 'var(--space-xs) var(--space-sm)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-sm)',
                    whiteSpace: 'nowrap', pointerEvents: 'none',
                    transition: 'opacity 0.12s', zIndex: 9999,
                    border: '1px solid var(--color-border)',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  {item.label}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User info + Logout */}
      <div style={{
        borderTop: '1px solid var(--color-border-subtle)',
        padding: s ? 'var(--space-sm) 0' : 'var(--space-md) var(--space-lg)',
      }}>
        {!s && user && (
          <div style={{
            marginBottom: 'var(--space-sm)',
            fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
            textAlign: 'center',
          }}>
            <div style={{
              color: 'var(--color-text)', fontWeight: 600,
              fontSize: 'var(--text-sm)',
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {user.firstName} {user.lastName}
            </div>
            <div style={{ textTransform: 'capitalize' }}>{user.role}</div>
            {role === 'driver' && (
              <div style={{ marginTop: 4 }}>
                <TrackingStatusIndicator status={trackingStatus} />
              </div>
            )}
          </div>
        )}
        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, width: '100%',
            padding: s ? 'var(--space-sm)' : 'var(--space-sm) var(--space-md)',
            background: 'transparent',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-red)',
            cursor: 'pointer',
            fontSize: 'var(--text-sm)',
            transition: 'background 0.12s',
          }}
          aria-label={t('nav.logout')}
        >
          <LogOut size={16} />
          {!s && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          style={{
            position: 'fixed', top: 10, left: 10, zIndex: 1100,
            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
            color: 'var(--color-text)', borderRadius: 'var(--radius-md)',
            padding: 8, cursor: 'pointer', display: 'flex',
          }}
          aria-label={t('nav.openMenu')}
        >
          <Menu size={20} />
        </button>
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'var(--color-overlay)',
              zIndex: 1199,
            }}
          />
        )}
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1200,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.2s ease',
        }}>
          {sidebarContent}
        </div>
      </>
    );
  }

  return (
    <div style={{
      width: sidebarWidth, flexShrink: 0, transition: 'width 0.2s ease',
    }}>
      {sidebarContent}
    </div>
  );
}
