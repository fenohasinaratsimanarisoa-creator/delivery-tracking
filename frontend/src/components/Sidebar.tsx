import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { getGroupedMenuItemsForRole } from './menuItems';
import { useAuth } from '../hooks/AuthContext';
import NotificationBell from './NotificationBell';
import TrackingStatusIndicator from './TrackingStatusIndicator';
import { useTrackingStatus } from '../services/tracking/TrackingContext';
import styles from './Sidebar.module.css';

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 60;

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  // Préférence PERSISTÉE : avant, un useEffect remettait `collapsed` à false à
  // CHAQUE navigation — la barre se ré-ouvrait sans arrêt malgré le choix de
  // l'utilisateur.
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dt-sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem('dt-sidebar-collapsed', next ? '1' : '0');
    } catch {
      /* stockage indisponible : préférence non persistée, sans incidence */
    }
  };
  const tooltipTimer = useRef<ReturnType<typeof setTimeout>>();

  const role = user?.role ?? 'admin';
  const trackingStatus = useTrackingStatus();
  const groups = getGroupedMenuItemsForRole(role, t);

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const sidebarContent = (
    <div className={styles.sidebarInner}
      style={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED }}>
      {/* Header */}
      <div className={styles.header}
        style={{ justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? 'var(--space-lg) 0' : 'var(--space-lg) var(--space-lg)' }}>
        {!collapsed && (
          <span className={styles.logoExpanded}>
            LogiTrack
          </span>
        )}
        {collapsed && (
          <span className={styles.logoCollapsed}>
            L
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={styles.collapseBtn}
          aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Notification bell in sidebar header area for expanded */}
      {!collapsed && (
        <div className={styles.notifArea}>
          <NotificationBell />
        </div>
      )}

      {/* Navigation */}
      <nav className={styles.nav}>
        {groups.map((group) => (
          <div key={group.section ?? 'flat'} className={styles.navGroup}>
            {group.section && !collapsed && (
              <div className={styles.sectionLabel}>{t(`nav.sections.${group.section}`)}</div>
            )}
            {group.items.map((item) => {
              const active = isActive(item.path);
              const Icon = item.icon;
              return (
                <div
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`${styles.navItem}${active ? ` ${styles.navItemActive}` : ''}`}
                  style={{
                    padding: collapsed ? 'var(--space-md) 0' : 'var(--space-sm) var(--space-lg)',
                    margin: collapsed ? 'var(--space-xs) auto' : 'var(--space-xs) var(--space-sm)',
                    width: collapsed ? 40 : 'auto',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                  }}
                  onMouseEnter={(e) => {
                    if (collapsed) {
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
                  {!collapsed && (
                    <span className={styles.navItemLabel}
                      style={{ fontWeight: active ? 600 : 400 }}>
                      {item.label}
                    </span>
                  )}
                  {collapsed && (
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
          </div>
        ))}
      </nav>

      {/* User info + Logout */}
      <div className={styles.userSection}
        style={{ padding: collapsed ? 'var(--space-sm) 0' : 'var(--space-md) var(--space-lg)' }}>
        {!collapsed && user && (
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
          style={{ padding: collapsed ? 'var(--space-sm)' : 'var(--space-sm) var(--space-md)' }}
          aria-label={t('nav.logout')}
        >
          <LogOut size={16} />
          {!collapsed && <span>{t('nav.logout')}</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.desktopWrapper} style={{ width: sidebarWidth }}>
      {sidebarContent}
    </div>
  );
}