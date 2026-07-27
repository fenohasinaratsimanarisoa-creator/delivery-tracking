import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { getMenuItemsForRole } from './menuItems';
import { useAuth } from '../hooks/AuthContext';
import NotificationBell from './NotificationBell';
import TrackingStatusIndicator from './TrackingStatusIndicator';
import { useTrackingStatus } from '../services/tracking/TrackingContext';
import styles from './Sidebar.module.css';

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
  const items = getMenuItemsForRole(role, t);

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const s = (collapsed && !isMobile);

  const sidebarContent = (
    <div className={styles.sidebarInner}
      style={{ width: s ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED }}>
      {/* Header */}
      <div className={styles.header}
        style={{ justifyContent: s ? 'center' : 'space-between', padding: s ? 'var(--space-lg) 0' : 'var(--space-lg) var(--space-lg)' }}>
        {!s && (
          <span className={styles.logoExpanded}>
            LogiTrack
          </span>
        )}
        {s && (
          <span className={styles.logoCollapsed}>
            L
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={styles.collapseBtn}
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            className={styles.mobileCloseBtn}
            aria-label={t('nav.closeMenu')}
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Notification bell in sidebar header area for expanded */}
      {!s && (
        <div className={styles.notifArea}>
          <NotificationBell />
        </div>
      )}

      {/* Navigation */}
      <nav className={styles.nav}>
        {items.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <div
              key={item.path}
              onClick={() => navigate(item.path)}
              className={styles.navItem}
              style={{
                padding: s ? 'var(--space-md) 0' : 'var(--space-sm) var(--space-lg)',
                background: active ? 'var(--color-accent-muted)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                margin: s ? 'var(--space-xs) auto' : 'var(--space-xs) var(--space-sm)',
                width: s ? 40 : 'auto',
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
              <div className={styles.navItemIcon}>
                <Icon size={18} />
              </div>
              {!s && (
                <span className={styles.navItemLabel}
                  style={{ fontWeight: active ? 600 : 400 }}>
                  {item.label}
                </span>
              )}
              {s && (
                <div
                  data-tooltip
                  className={styles.tooltip}
                  style={{ left: SIDEBAR_COLLAPSED + 8 }}
                >
                  {item.label}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* User info + Logout */}
      <div className={styles.userSection}
        style={{ padding: s ? 'var(--space-sm) 0' : 'var(--space-md) var(--space-lg)' }}>
        {!s && user && (
          <div className={styles.userInfo}>
            <div className={styles.userName}>
              {user.firstName} {user.lastName}
            </div>
            <div className={styles.userRole}>{user.role}</div>
            {role === 'driver' && (
              <div style={{ marginTop: 4 }}>
                <TrackingStatusIndicator status={trackingStatus} />
              </div>
            )}
          </div>
        )}
        <button
          onClick={logout}
          className={styles.logoutBtn}
          style={{ padding: s ? 'var(--space-sm)' : 'var(--space-sm) var(--space-md)' }}
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
          className={styles.hamburgerBtn}
          aria-label={t('nav.openMenu')}
        >
          <Menu size={20} />
        </button>
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            className={styles.mobileOverlay}
          />
        )}
        <div className={styles.mobilePanel}
          style={{ transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)' }}>
          {sidebarContent}
        </div>
      </>
    );
  }

  return (
    <div className={styles.desktopWrapper} style={{ width: sidebarWidth }}>
      {sidebarContent}
    </div>
  );
}
