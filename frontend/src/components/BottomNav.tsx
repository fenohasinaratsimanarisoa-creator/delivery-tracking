import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../hooks/AuthContext';
import { getMenuItemsForRole, type MenuItem, type Role } from './menuItems';
import { useNotifications } from '../services/notifications/useNotifications';
import styles from './BottomNav.module.css';

const PRIMARY_PATHS: Record<string, string[]> = {
  admin: ['/dashboard', '/deliveries', '/map', '/reports', '/notifications'],
  dispatcher: ['/dashboard', '/deliveries', '/map', '/drivers', '/notifications'],
  driver: ['/my-deliveries', '/my-vehicle', '/notifications'],
  client: ['/my-orders', '/tracking', '/notifications'],
};

const MOBILE_QUERY = '(max-width: 767px)';

export default function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications({ limit: 1 });
  const role = (user?.role || 'client') as Role;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  );
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  const items = getMenuItemsForRole(role, t);
  const primaryPaths = PRIMARY_PATHS[role] ?? [];
  const primary = items.filter((item) => primaryPaths.includes(item.path));
  const more = items.filter((item) => !primaryPaths.includes(item.path));

  const isActive = (item: MenuItem) => {
    const p = item.path;
    return location.pathname === p || (p !== '/' && location.pathname.startsWith(`${p}/`));
  };

  const onNavigate = (path: string) => {
    setMoreOpen(false);
    if (location.pathname === path) return;
    navigate(path);
  };

  if (!isMobile) return null;

  return (
    <>
      <nav className={styles.nav} aria-label={t('nav.title')}>
        {primary.map((item) => {
          const Icon = item.icon;
          const active = isActive(item);
          const showBadge = item.path === '/notifications' && unreadCount > 0;
          return (
            <button
              key={item.path}
              type="button"
              className={`${styles.item} ${active ? styles.itemActive : ''}`}
              onClick={() => onNavigate(item.path)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
            >
              <span className={styles.itemGlow} />
              <span className={styles.itemWrap}>
                <Icon className={styles.icon} />
                {showBadge && <span className={styles.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </span>
              <span className={styles.label}>{item.label}</span>
            </button>
          );
        })}
        {more.length > 0 && (
          <button
            type="button"
            className={`${styles.item} ${moreOpen ? styles.itemActive : ''}`}
            onClick={() => setMoreOpen((o) => !o)}
            aria-label={t('nav.more')}
          >
            <span className={styles.itemGlow} />
            <span className={styles.itemWrap}>
              <MoreHorizontal className={styles.icon} />
            </span>
            <span className={styles.label}>{t('nav.more')}</span>
          </button>
        )}
      </nav>

      {moreOpen && (
        <div className={styles.moreOverlay} onClick={() => setMoreOpen(false)} role="presentation">
          <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sheetHandle} />
            <div className={styles.sheetTitle}>{t('nav.moreTitle')}</div>
            {more.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <button
                  key={item.path}
                  type="button"
                  className={`${styles.sheetItem} ${active ? styles.sheetItemActive : ''}`}
                  onClick={() => onNavigate(item.path)}
                >
                  <Icon size={20} className={styles.sheetItemIcon} />
                  <span className={styles.sheetItemLabel}>{item.label}</span>
                  {active && <span className={styles.sheetItemDot} />}
                </button>
              );
            })}

            <div className={styles.sheetDivider} />
            {user && (
              <div className={styles.sheetUser}>
                <span className={styles.sheetUserIcon}><UserRound size={18} /></span>
                <span className={styles.sheetUserId}>
                  <span className={styles.sheetUserName}>{user.firstName} {user.lastName}</span>
                  <span className={styles.sheetUserRole}>{t('nav.signedInAs')} {user.role}</span>
                </span>
              </div>
            )}
            <button
              type="button"
              className={styles.sheetLogout}
              onClick={logout}
            >
              <LogOut size={18} />
              <span>{t('nav.logout')}</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}