import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDate, formatDateTime } from '../../services/i18n/formatDate';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import {
  Shield, Building2, Package, CreditCard,
  TrendingUp, TrendingDown, Activity, LogOut, Search, X,
  Eye, EyeOff, DollarSign, UserPlus, Users,
} from 'lucide-react';
import Button from '../../components/Button';
import adminApi, { refreshAdminSession } from '../../services/api/adminClient';
import { getAdminToken, setAdminToken } from '../../services/auth/adminTokenStore';
import styles from './AdminDashboard.module.css';

interface Metrics {
  mrr: number;
  monthlyRevenue: number;
  totalCompanies: number;
  activeCompanies: number;
  newCompaniesThisMonth: number;
  totalDeliveries: number;
  activeSubscriptions: number;
  churnRate: number;
  topCompanies: {
    id: string; name: string; users: number; deliveries: number;
    vehicles: number; plan: string; tier: string;
  }[];
  growthData: {
    month: string; companies: number; activeSubscriptions: number; deliveries: number;
  }[];
  invoiceStats: Record<string, { count: number; amount: number }>;
}

interface Tenant {
  id: string; name: string; email: string | null; phone: string | null;
  createdAt: string;
  users: { id: string; email: string; firstName: string; lastName: string }[];
  subscription: { status: string; plan: { name: string; tier: string; price: number }; currentPeriodEnd: string } | null;
  _count: { users: number; vehicles: number; drivers: number; deliveries: number };
}

interface Admin {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  totpEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

interface AuditLog {
  id: string; action: string; createdAt: string;
  ip: string | null; userAgent: string | null;
  targetCompany: { id: string; name: string } | null;
  targetUserId: string | null;
  admin: { id: string; email: string; firstName: string; lastName: string };
  metadata: { impersonatedAs?: string };
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string;
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardHeader}>
        <div className={styles.statCardIconBox} style={{ background: `${color}15`, color }}>
          <Icon size={18} />
        </div>
        <span className={styles.statCardLabel}>
          {label}
        </span>
      </div>
      <div className={styles.statCardValue}>
        {typeof value === 'number' && label.includes('MRR') ? `${value} €` : value}
      </div>
      {sub && (
        <div className={styles.statCardSub}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ImpersonationBanner({ user, onStop }: { user: { email: string; name: string }; onStop: () => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.impersonationBanner}>
      <div className={styles.impersonationInfo}>
        <Eye size={16} />
        <span>
          {t('admin.dashboard.impersonation', { name: user.name, email: user.email })}
        </span>
      </div>
      <button
        onClick={onStop}
        className={styles.impersonationBtn}
      >
        {t('admin.dashboard.impersonationLeave')}
      </button>
    </div>
  );
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [tab, setTab] = useState<'dashboard' | 'tenants' | 'audit' | 'admins'>('dashboard');
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [auditLogs, setAuditLogs] = useState<{ data: AuditLog[]; total: number; page: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [impersonating, setImpersonating] = useState<{ email: string; name: string; token: string; role: string } | null>(null);
  const [tenantSearch, setTenantSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', firstName: '', lastName: '' });

  // 'checking' : au (re)chargement de page, l'access token en mémoire est perdu
  // (adminTokenStore n'est pas persisté). On tente d'abord une rotation
  // silencieuse via le cookie httpOnly admin_refreshToken AVANT de renvoyer sur
  // l'écran de login — sinon l'admin ressaisit mot de passe + TOTP à chaque F5.
  const [authState, setAuthState] = useState<'checking' | 'authed' | 'anon'>(
    getAdminToken() ? 'authed' : 'checking',
  );

  useEffect(() => {
    if (getAdminToken()) { setAuthState('authed'); return; }
    let cancelled = false;
    refreshAdminSession().then((tok) => {
      if (!cancelled) setAuthState(tok ? 'authed' : 'anon');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (authState === 'anon') navigate('/admin/login');
  }, [authState, navigate]);

  useEffect(() => {
    if (authState === 'authed') loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'dashboard') {
        const [m, t] = await Promise.all([
          adminApi.get('/metrics').then(r => r.data),
          adminApi.get('/tenants').then(r => r.data),
        ]);
        setMetrics(m);
        setTenants(t);
      } else if (tab === 'tenants') {
        const t = await adminApi.get('/tenants').then(r => r.data);
        setTenants(t);
      } else if (tab === 'audit') {
        const a = await adminApi.get(`/audit-logs?page=${auditPage}&limit=20`).then(r => r.data);
        setAuditLogs(a);
      } else if (tab === 'admins') {
        const a = await adminApi.get('/admins').then(r => r.data);
        setAdmins(a);
      }
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 401) {
        setAdminToken(null);
        navigate('/admin/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImpersonate = async (companyId: string) => {
    try {
      const res = await adminApi.post(`/tenants/${companyId}/impersonate`);
      const u = res.data.user;
      setImpersonating({
        email: u.email,
        name: `${u.firstName} ${u.lastName}`,
        token: res.data.accessToken,
        role: u.role,
      });
    } catch (err: unknown) {
      alert(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'));
    }
  };

  const stopImpersonating = () => {
    setImpersonating(null);
  };

  const handleToggleTenant = async (companyId: string) => {
    await adminApi.patch(`/tenants/${companyId}/toggle`);
    loadData();
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.post('/admins', createForm);
      setShowCreateAdmin(false);
      setCreateForm({ email: '', password: '', firstName: '', lastName: '' });
      const a = await adminApi.get('/admins').then(r => r.data);
      setAdmins(a);
    } catch (err: unknown) {
      alert(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'));
    }
  };

  const handleLogout = async () => {
    try {
      await adminApi.post('/auth/logout');
    } catch {
      // Réseau / token déjà expiré : on nettoie quand même localement. Le cookie
      // sera de toute façon rejeté au prochain refresh.
    }
    setAdminToken(null);
    navigate('/admin/login');
  };

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    t.email?.toLowerCase().includes(tenantSearch.toLowerCase())
  );

  if (authState === 'checking') {
    return (
      <div className={styles.loadingState}>
        <Activity size={20} className="spin" />
        <span>{t('common.loading')}</span>
      </div>
    );
  }
  if (authState !== 'authed') return null;

  if (impersonating) {
    // On cible la page d'accueil du RÔLE impersoné (pas /dashboard, réservé
    // admin/dispatcher) : un driver -> /my-deliveries, un client -> /my-orders,
    // sinon /dashboard. Le token d'impersonation est passé en query string et
    // consommé par AuthContext (voir ?token= dans AuthContext.tsx).
    const IMPERSONATION_HOME: Record<string, string> = {
      admin: '/dashboard',
      dispatcher: '/dashboard',
      driver: '/my-deliveries',
      client: '/my-orders',
    };
    const home = IMPERSONATION_HOME[impersonating.role] || '/dashboard';
    return (
      <div>
        <ImpersonationBanner user={impersonating} onStop={stopImpersonating} />
        <iframe
          src={`${home}?token=${impersonating.token}`}
          className={styles.iframeStyle}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.headerRow}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIconBox}>
            <Shield size={22} />
          </div>
          <div>
            <h1 className={styles.headerTitle}>
              {t('admin.dashboard.title')}
            </h1>
            <p className={styles.headerSubtitle}>
              {t('admin.dashboard.subtitle')}
            </p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button onClick={() => setTab('dashboard')} className={`${styles.tabBtn} ${tab === 'dashboard' ? styles.tabBtnActive : ''}`}>
            <Activity size={14} className={styles.tabBtnIcon} />
            {t('admin.dashboard.tabs.overview')}
          </button>
          <button onClick={() => setTab('tenants')} className={`${styles.tabBtn} ${tab === 'tenants' ? styles.tabBtnActive : ''}`}>
            <Building2 size={14} className={styles.tabBtnIcon} />
            {t('admin.dashboard.tabs.tenants')}
          </button>
          <button onClick={() => setTab('audit')} className={`${styles.tabBtn} ${tab === 'audit' ? styles.tabBtnActive : ''}`}>
            <EyeOff size={14} className={styles.tabBtnIcon} />
            {t('admin.dashboard.tabs.audit')}
          </button>
          <button onClick={() => setTab('admins')} className={`${styles.tabBtn} ${tab === 'admins' ? styles.tabBtnActive : ''}`}>
            <Users size={14} className={styles.tabBtnIcon} />
            {t('admin.dashboard.tabs.admins')}
          </button>
          <Button variant="danger" size="sm" icon={<LogOut size={14} />} onClick={handleLogout}>
            {t('admin.dashboard.tabs.logout')}
          </Button>
        </div>
      </div>

      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.skeletonStats}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className={`${styles.skeletonCard} ${styles.skeletonStat}`} />
            ))}
          </div>
          <div className={`${styles.skeletonCard} ${styles.skeletonChart}`} />
          <div className={`${styles.skeletonCard} ${styles.skeletonTable}`} />
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
            {t('common.loading')}
          </div>
        </div>
      )}

      {!loading && tab === 'dashboard' && metrics && (
        <>
          {/* Stats Grid */}
          <div className={styles.statsGrid}>
            <StatCard icon={DollarSign} label="MRR" value={metrics.mrr} sub={t('admin.dashboard.stats.mrrSub')} color="var(--color-teal)" />
            <StatCard icon={CreditCard} label={t('admin.dashboard.stats.monthlyRevenue')} value={metrics.monthlyRevenue} sub={t('admin.dashboard.stats.paidInvoicesSub')} color="var(--color-accent)" />
            <StatCard icon={Building2} label={t('admin.dashboard.stats.activeTenants')} value={metrics.activeCompanies} sub={t('admin.dashboard.stats.newTenantsSub', { count: metrics.newCompaniesThisMonth })} color="var(--color-blue)" />
            <StatCard icon={Package} label={t('admin.dashboard.stats.deliveries')} value={metrics.totalDeliveries} sub={t('admin.dashboard.stats.thisMonth')} color="var(--color-orange)" />
            <StatCard icon={Activity} label={t('admin.dashboard.stats.activeSubscriptions')} value={metrics.activeSubscriptions} color="var(--color-purple)" />
            <StatCard
              icon={metrics.churnRate > 5 ? TrendingDown : TrendingUp}
              label={t('admin.dashboard.stats.attritionRate')}
              value={`${metrics.churnRate}%`}
              color={metrics.churnRate > 5 ? 'var(--color-red)' : 'var(--color-teal)'}
            />
          </div>

          {/* Charts */}
          <div className={styles.chartsRow}>
            <div className={styles.chartCard} style={{ flex: 2, minWidth: 400 }}>
              <h3 className={styles.chartCardTitle}>
                {t('admin.dashboard.charts.tenantGrowth')}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={metrics.growthData}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <Tooltip contentStyle={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', fontSize: 12,
                  }} />
                  <Area type="monotone" dataKey="companies" stroke="var(--color-accent)" fill="var(--color-accent-muted)" name="Tenants" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className={styles.chartCard} style={{ flex: 3, minWidth: 400 }}>
              <h3 className={styles.chartCardTitle}>
                {t('admin.dashboard.charts.monthlyDeliveries')}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={metrics.growthData}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <Tooltip contentStyle={{
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)', fontSize: 12,
                  }} />
                  <Bar dataKey="deliveries" fill="var(--color-teal)" radius={[4, 4, 0, 0]} name={t('admin.dashboard.stats.deliveries')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Companies */}
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionTitle}>
                {t('admin.dashboard.topCompanies')}
              </h3>
            </div>
            <div className={styles.scrollTable}>
              <table className={styles.table}>
                <thead>
                  <tr className={styles.tableHeadRow}>
                    <th className={styles.tableHeadCell}>{t('admin.dashboard.companyTable.company')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.companyTable.plan')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.companyTable.users')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.companyTable.vehicles')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.companyTable.deliveries')}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topCompanies.map((c) => (
                    <tr key={c.id} className={styles.tableRow}>
                      <td className={styles.tableCell}><span className={styles.cellPrimary}>{c.name}</span></td>
                      <td className={styles.tableCellCenter}>
                        <span className={styles.badge} style={{
                          background: c.tier === 'enterprise' ? 'var(--color-accent-muted)' : c.tier === 'pro' ? 'var(--color-teal-muted)' : 'transparent',
                          color: c.tier === 'enterprise' ? 'var(--color-accent)' : c.tier === 'pro' ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                        }}>
                          {c.tier === 'free' ? t('admin.dashboard.companyTable.freeTier') : c.plan}
                        </span>
                      </td>
                      <td className={styles.tableCellSecondaryCenter}>{c.users}</td>
                      <td className={styles.tableCellSecondaryCenter}>{c.vehicles}</td>
                      <td className={styles.tableCellSecondaryCenter}>{c.deliveries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && tab === 'tenants' && (
        <div className={styles.sectionCard}>
          <div className={styles.sectionCardHeaderNoBorder}>
            <h3 className={styles.sectionTitle}>
              {t('admin.dashboard.tenantsTab.title', { count: filteredTenants.length })}
            </h3>
            <div className={styles.searchWrapper}>
              <Search size={14} className={styles.searchIcon} />
              <input
                type="text"
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                placeholder={t('admin.dashboard.tenantsTab.search')}
                className={styles.searchInput}
              />
            </div>
          </div>
          <div className={styles.scrollTable}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeadRow}>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.companyTable.company')}</th>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.tenantsTab.contact')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.plan')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.users')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.vehicles')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.deliveries')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.createdDate')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.tenantsTab.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} className={styles.tableRow}>
                    <td className={styles.tableCell}><span className={styles.cellPrimary}>{tenant.name}</span></td>
                    <td className={`${styles.tableCellSecondary} ${styles.tableEllipsis}`}>
                      {tenant.email || tenant.users[0]?.email || '—'}
                    </td>
                    <td className={styles.tableCellCenter}>
                      <span className={styles.badge} style={{
                        background: tenant.subscription?.plan.tier === 'enterprise' ? 'var(--color-accent-muted)' :
                          tenant.subscription?.plan.tier === 'pro' ? 'var(--color-teal-muted)' : 'transparent',
                        color: tenant.subscription?.plan.tier === 'enterprise' ? 'var(--color-accent)' :
                          tenant.subscription?.plan.tier === 'pro' ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                      }}>
                        {tenant.subscription ? tenant.subscription.plan.name : '—'}
                      </span>
                    </td>
                    <td className={styles.tableCellSecondaryCenter}>{tenant._count.users}</td>
                    <td className={styles.tableCellSecondaryCenter}>{tenant._count.vehicles}</td>
                    <td className={styles.tableCellSecondaryCenter}>{tenant._count.deliveries}</td>
                    <td className={styles.tableCellTiny}>
                      {formatDate(tenant.createdAt)}
                    </td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actionsRow}>
                        <button
                          onClick={() => handleImpersonate(tenant.id)}
                          title={t('admin.dashboard.tenantsTab.impersonate')}
                          className={styles.iconBtn}
                          style={{ color: 'var(--color-accent)' }}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleToggleTenant(tenant.id)}
                          title={t('admin.dashboard.tenantsTab.toggle')}
                          className={styles.iconBtn}
                          style={{ color: 'var(--color-red)' }}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === 'audit' && auditLogs && (
        <div className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <h3 className={styles.sectionTitle}>
              {t('admin.dashboard.auditTab.title', { count: auditLogs.total })}
            </h3>
          </div>
          <div className={styles.scrollTable}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeadRow}>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.auditTab.admin')}</th>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.auditTab.action')}</th>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.auditTab.target')}</th>
                  <th className={styles.tableHeadCell}>{t('admin.dashboard.auditTab.ip')}</th>
                  <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.auditTab.date')}</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.data.map((log) => (
                  <tr key={log.id} className={styles.tableRow}>
                    <td className={styles.tableCell}><span className={styles.cellPrimary}>{log.admin.firstName} {log.admin.lastName}</span></td>
                    <td style={{ padding: '10px var(--space-md)' }}>
                      <span className={styles.badge} style={{
                        background: log.action === 'impersonate' ? 'var(--color-accent-muted)' :
                          log.action === 'login' || log.action === 'login_success' ? 'var(--color-teal-muted)' :
                          log.action === 'tenant_toggle' ? 'var(--color-orange-muted)' : 'transparent',
                        color: log.action === 'impersonate' ? 'var(--color-accent)' :
                          log.action === 'login' || log.action === 'login_success' ? 'var(--color-teal)' :
                          log.action === 'tenant_toggle' ? 'var(--color-orange)' : 'var(--color-text-secondary)',
                      }}>
                        {log.action === 'login' ? t('admin.dashboard.auditActions.login') :
                         log.action === 'login_2fa_required' ? t('admin.dashboard.auditActions.login2faRequired') :
                         log.action === 'login_success' ? t('admin.dashboard.auditActions.loginSuccess') :
                         log.action === 'impersonate' ? t('admin.dashboard.auditActions.impersonate') :
                         log.action === 'tenant_toggle' ? t('admin.dashboard.auditActions.tenantToggle') :
                         log.action === 'logout' ? t('admin.dashboard.auditActions.logout') : log.action}
                      </span>
                    </td>
                    <td className={styles.tableCellSecondary}>
                      {log.targetCompany?.name || (log.metadata?.impersonatedAs ? `→ ${log.metadata.impersonatedAs}` : '—')}
                    </td>
                    <td className={styles.tableCellTiny}>
                      {log.ip || '—'}
                    </td>
                    <td className={styles.tableCellTiny}>
                      {formatDateTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {auditLogs.totalPages > 1 && (
            <div className={styles.paginationBar}>
              {Array.from({ length: auditLogs.totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => { setAuditPage(p); }}
                  className={`${styles.pageBtn} ${p === auditPage ? styles.pageBtnActive : ''}`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === 'admins' && (
        <div>
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionTitle}>
                {t('admin.dashboard.adminsTab.title', { count: admins.length })}
              </h3>
              <button
                onClick={() => setShowCreateAdmin(true)}
                className={styles.addBtn}
              >
                <UserPlus size={14} />
                {t('admin.dashboard.adminsTab.add')}
              </button>
            </div>
            <div className={styles.scrollTable}>
              <table className={styles.table}>
                <thead>
                  <tr className={styles.tableHeadRow}>
                    <th className={styles.tableHeadCell}>{t('admin.dashboard.adminsTab.name')}</th>
                    <th className={styles.tableHeadCell}>{t('admin.dashboard.adminsTab.email')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.adminsTab.tfa')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.adminsTab.active')}</th>
                    <th className={styles.tableHeadCellCenter}>{t('admin.dashboard.adminsTab.createdDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a: Admin) => (
                    <tr key={a.id} className={styles.tableRow}>
                      <td className={styles.tableCell}>
                        <span className={styles.cellPrimary}>{a.firstName} {a.lastName}</span>
                      </td>
                      <td className={styles.tableCellSecondary}>
                        {a.email}
                      </td>
                      <td className={styles.tableCellCenter}>
                        <span className={styles.badge} style={{
                          background: a.totpEnabled ? 'var(--color-teal-muted)' : 'var(--color-orange-muted)',
                          color: a.totpEnabled ? 'var(--color-teal)' : 'var(--color-orange)',
                        }}>
                          {a.totpEnabled ? t('admin.dashboard.adminsTab.tfaEnabled') : t('admin.dashboard.adminsTab.tfaDisabled')}
                        </span>
                      </td>
                      <td className={styles.tableCellCenter}>
                        <span className={styles.badge} style={{
                          background: a.isActive ? 'var(--color-teal-muted)' : 'var(--color-red-muted)',
                          color: a.isActive ? 'var(--color-teal)' : 'var(--color-red)',
                        }}>
                          {a.isActive ? t('admin.dashboard.adminsTab.isActiveYes') : t('admin.dashboard.adminsTab.isActiveNo')}
                        </span>
                      </td>
                      <td className={styles.tableCellTiny}>
                        {formatDate(a.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showCreateAdmin && (
            <div className={styles.modalOverlay} onClick={() => setShowCreateAdmin(false)}>
              <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <h3 className={styles.modalTitle}>
                  {t('admin.dashboard.createAdmin.title')}
                </h3>
                <form onSubmit={handleCreateAdmin}>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>
                      {t('admin.dashboard.createAdmin.firstName')}
                    </label>
                    <input
                      value={createForm.firstName}
                      onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })}
                      required
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>
                      {t('admin.dashboard.createAdmin.lastName')}
                    </label>
                    <input
                      value={createForm.lastName}
                      onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })}
                      required
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.formField}>
                    <label className={styles.formLabel}>
                      {t('admin.dashboard.createAdmin.email')}
                    </label>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                      required
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.lastFormField}>
                    <label className={styles.formLabel}>
                      {t('admin.dashboard.createAdmin.password')}
                    </label>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                      required
                      minLength={6}
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.formActions}>
                    <button
                      type="button"
                      onClick={() => setShowCreateAdmin(false)}
                      className={styles.cancelBtn}
                    >
                      {t('admin.dashboard.createAdmin.cancel')}
                    </button>
                    <button
                      type="submit"
                      className={styles.submitBtn}
                    >
                      {t('admin.dashboard.createAdmin.create')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
