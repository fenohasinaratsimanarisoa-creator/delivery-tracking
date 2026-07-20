import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react';
import { getMenuItemsForRole } from './menuItems';
import { useAuth } from '../hooks/AuthContext';

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 60;
const MOBILE_BREAKPOINT = 768;

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
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
  const items = getMenuItemsForRole(role);

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  const sidebarWidth = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;

  const sidebarContent = (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      width: collapsed && !isMobile ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED,
      background: '#1e293b', color: '#fff', transition: 'width 0.25s ease',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: collapsed && !isMobile ? 'center' : 'space-between',
        padding: collapsed && !isMobile ? '12px 0' : '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.1)', minHeight: 56,
      }}>
        {(!collapsed || isMobile) && (
          <span style={{ fontWeight: 700, fontSize: '1.1rem', whiteSpace: 'nowrap' }}>
            DeliveryTrack
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        )}
        {isMobile && (
          <button
            onClick={() => setMobileOpen(false)}
            style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {items.map((item) => {
          const active = isActive(item.path);
          const Icon = item.icon;
          return (
            <div
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: collapsed && !isMobile ? '12px 0' : '10px 16px',
                cursor: 'pointer', whiteSpace: 'nowrap',
                background: active ? 'rgba(59,130,246,0.2)' : 'transparent',
                borderLeft: active ? '3px solid #3b82f6' : '3px solid transparent',
                color: active ? '#fff' : '#94a3b8',
                transition: 'background 0.15s, color 0.15s',
              }}
              onMouseEnter={(e) => {
                if (collapsed && !isMobile) {
                  tooltipTimer.current = setTimeout(() => {
                    const el = e.currentTarget;
                    const tip = el.querySelector('[data-tooltip]') as HTMLElement;
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
                display: 'flex', justifyContent: 'center', minWidth: collapsed && !isMobile ? '100%' : 24,
              }}>
                <Icon size={20} />
              </div>
              {(!collapsed || isMobile) && <span style={{ fontSize: '0.9rem' }}>{item.label}</span>}
              {collapsed && !isMobile && (
                <div
                  data-tooltip
                  style={{
                    position: 'fixed', left: SIDEBAR_COLLAPSED + 8, opacity: 0,
                    background: '#0f172a', color: '#fff', padding: '4px 10px',
                    borderRadius: 4, fontSize: '0.8rem', whiteSpace: 'nowrap',
                    pointerEvents: 'none', transition: 'opacity 0.15s', zIndex: 9999,
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
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: collapsed && !isMobile ? '12px 0' : '12px 16px',
      }}>
        {(!collapsed || isMobile) && user && (
          <div style={{ marginBottom: 8, fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center' }}>
            <div style={{ color: '#fff', fontWeight: 600 }}>{user.email}</div>
            <div style={{ textTransform: 'capitalize' }}>{user.role}</div>
          </div>
        )}
        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: collapsed && !isMobile ? 'center' : 'center',
            gap: 8, width: '100%', padding: '8px 12px',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: '#f87171', cursor: 'pointer',
            fontSize: '0.85rem', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(248,113,113,0.1)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          aria-label="Logout"
        >
          <LogOut size={16} />
          {(!collapsed || isMobile) && <span>Déconnexion</span>}
        </button>
      </div>
    </div>
  );

  // Mobile: hamburger button + overlay drawer
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          style={{
            position: 'fixed', top: 10, left: 10, zIndex: 1100,
            background: '#1e293b', border: 'none', color: '#fff',
            borderRadius: 6, padding: 8, cursor: 'pointer',
          }}
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
              zIndex: 1199,
            }}
          />
        )}
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 1200,
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease',
        }}>
          {sidebarContent}
        </div>
      </>
    );
  }

  // Desktop: persistent sidebar
  return (
    <div style={{
      width: sidebarWidth, flexShrink: 0, transition: 'width 0.25s ease',
    }}>
      {sidebarContent}
    </div>
  );
}
