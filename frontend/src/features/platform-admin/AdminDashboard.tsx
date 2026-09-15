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
  Eye, EyeOff, DollarSign, UserPlus, Users, ArrowLeft, ImageIcon,
} from 'lucide-react';
import Button from '../../components/Button';
import DataTable from '../../components/DataTable';
import Badge, { type BadgeVariant } from '../../components/Badge';
import Modal from '../../components/Modal';
import Input from '../../components/Input';
import { useToast } from '../../components/Toast';
import adminApi, { refreshAdminSession } from '../../services/api/adminClient';
import { formatAriary } from '../../services/formatAriary';
import { getAdminToken, setAdminToken } from '../../services/auth/adminTokenStore';
import styles from './AdminDashboard.module.css';

// Une seule table tier/action → variante par écran (voir aussi
// services/deliveryStatus.ts pour le même principe côté livraisons).
const TIER_VARIANT: Record<string, BadgeVariant> = {
  enterprise: 'accent',
  pro: 'success',
  free: 'neutral',
};

const AUDIT_ACTION_VARIANT: Record<string, BadgeVariant> = {
  impersonate: 'accent',
  login: 'success',
  login_success: 'success',
  tenant_toggle: 'warning',
};

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

// Paiement manuel (2026-09-15) : preuves soumises par les sociétés + numéros
// Mobile Money affichés côté client — voir ManualBillingModule côté backend.
interface PaymentProofRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  reference: string;
  claimedAmount: number;
  createdAt: string;
  company: { id: string; name: string; email: string | null };
  claimedPlan: { name: string; price: number; currency: string };
  paymentMethod: { provider: string; phoneNumber: string; holderName: string };
  submittedBy: { firstName: string; lastName: string; email: string };
}

interface PaymentMethodRow {
  id: string;
  provider: 'mvola' | 'orange_money';
  phoneNumber: string;
  holderName: string;
  isActive: boolean;
}

interface AuditLog {
  id: string; action: string; createdAt: string;
  ip: string | null; userAgent: string | null;
  targetCompany: { id: string; name: string } | null;
  targetUserId: string | null;
  admin: { id: string; email: string; firstName: string; lastName: string };
  metadata: { impersonatedAs?: string };
}

// Initiales pour l'avatar d'une entreprise/personne (2 lettres max) — même
// idiome visuel que les chips d'avatar déjà utilisés ailleurs dans l'app.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return <div className={styles.avatar}>{initials(name)}</div>;
}

function StatCard({ icon: Icon, label, value, sub, color, trend }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string; trend?: { value: number; positive: boolean };
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardHeader}>
        <div className={styles.statCardHeaderLeft}>
          <div className={styles.statCardIconBox} style={{ background: `${color}15`, color }}>
            <Icon size={18} />
          </div>
          <span className={styles.statCardLabel}>
            {label}
          </span>
        </div>
        {trend && (
          <span className={`${styles.statCardTrend} ${trend.positive ? styles.statCardTrendUp : styles.statCardTrendDown}`}>
            {trend.positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {trend.value}%
          </span>
        )}
      </div>
      <div className={styles.statCardValue}>
        {value}
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

type Tab = 'dashboard' | 'tenants' | 'audit' | 'admins' | 'payments';

const NAV_ITEMS: { key: Tab; icon: React.ElementType; labelKey: string }[] = [
  { key: 'dashboard', icon: Activity, labelKey: 'admin.dashboard.tabs.overview' },
  { key: 'tenants', icon: Building2, labelKey: 'admin.dashboard.tabs.tenants' },
  { key: 'audit', icon: EyeOff, labelKey: 'admin.dashboard.tabs.audit' },
  { key: 'admins', icon: Users, labelKey: 'admin.dashboard.tabs.admins' },
  { key: 'payments', icon: CreditCard, labelKey: 'admin.dashboard.tabs.payments' },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('dashboard');
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
  const [paymentProofs, setPaymentProofs] = useState<PaymentProofRow[]>([]);
  const [proofStatusFilter, setProofStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([]);
  const [approveResult, setApproveResult] = useState<{ code: string; expiresAt: string } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentProofRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [methodForm, setMethodForm] = useState<{ provider: 'mvola' | 'orange_money'; phoneNumber: string; holderName: string }>({
    provider: 'orange_money',
    phoneNumber: '',
    holderName: '',
  });

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
  }, [authState, tab, proofStatusFilter]);

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
      } else if (tab === 'payments') {
        const [proofs, methods] = await Promise.all([
          adminApi.get(`/payment-proofs?status=${proofStatusFilter}&limit=50`).then(r => r.data),
          adminApi.get('/payment-methods').then(r => r.data),
        ]);
        setPaymentProofs(proofs.items);
        setPaymentMethods(methods);
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
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
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
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
    }
  };

  const reloadPayments = async () => {
    const [proofs, methods] = await Promise.all([
      adminApi.get(`/payment-proofs?status=${proofStatusFilter}&limit=50`).then(r => r.data),
      adminApi.get('/payment-methods').then(r => r.data),
    ]);
    setPaymentProofs(proofs.items);
    setPaymentMethods(methods);
  };

  const handleApproveProof = async (proof: PaymentProofRow) => {
    try {
      const result = await adminApi.post(`/payment-proofs/${proof.id}/approve`).then(r => r.data);
      setApproveResult(result);
      await reloadPayments();
    } catch (err: unknown) {
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
    }
  };

  const handleRejectProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;
    try {
      await adminApi.post(`/payment-proofs/${rejectTarget.id}/reject`, { reason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      await reloadPayments();
    } catch (err: unknown) {
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
    }
  };

  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.post('/payment-methods', methodForm);
      setShowAddMethod(false);
      setMethodForm({ provider: 'orange_money', phoneNumber: '', holderName: '' });
      await reloadPayments();
    } catch (err: unknown) {
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
    }
  };

  const toggleMethodActive = async (method: PaymentMethodRow) => {
    try {
      await adminApi.patch(`/payment-methods/${method.id}`, { isActive: !method.isActive });
      await reloadPayments();
    } catch (err: unknown) {
      toast(((err as { response?: { data?: { message?: string } } })?.response?.data?.message) || t('common.error'), 'error');
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

  const activeNavItem = NAV_ITEMS.find((item) => item.key === tab) ?? NAV_ITEMS[0];
  const sectionSubtitleKey = {
    dashboard: 'overview', tenants: 'tenants', audit: 'audit', admins: 'admins', payments: 'payments',
  }[tab];

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          <div className={styles.sidebarBrandIcon}>
            <Shield size={18} />
          </div>
          <div className={styles.sidebarBrandText}>
            <span className={styles.sidebarBrandTitle}>{t('admin.dashboard.title')}</span>
            <span className={styles.sidebarBrandSub}>{t('admin.dashboard.subtitle')}</span>
          </div>
        </div>
        <nav className={styles.sidebarNav}>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`${styles.sidebarNavItem} ${active ? styles.sidebarNavItemActive : ''}`}
              >
                <span className={styles.sidebarNavIcon}><Icon size={17} /></span>
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <a href="/dashboard" className={styles.sidebarBackLink}>
            <ArrowLeft size={14} />
            <span>{t('admin.dashboard.backToApp')}</span>
          </a>
          <button className={styles.sidebarLogoutBtn} onClick={handleLogout}>
            <LogOut size={14} />
            <span>{t('admin.dashboard.tabs.logout')}</span>
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        {/* En-tête de section, dynamique selon l'onglet actif */}
        <div className={styles.pageHeader}>
          <div className={styles.pageHeaderIcon}>
            <activeNavItem.icon size={22} />
          </div>
          <div className={styles.pageHeaderText}>
            <span className={styles.kicker}>{t('admin.dashboard.subtitle')}</span>
            <h1 className={styles.pageTitle}>{t(activeNavItem.labelKey)}</h1>
            <p className={styles.pageSubtitle}>{t(`admin.dashboard.sectionSubtitle.${sectionSubtitleKey}`)}</p>
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
            <StatCard icon={DollarSign} label="MRR" value={formatAriary(metrics.mrr)} sub={t('admin.dashboard.stats.mrrSub')} color="var(--color-teal)" />
            <StatCard icon={CreditCard} label={t('admin.dashboard.stats.monthlyRevenue')} value={formatAriary(metrics.monthlyRevenue)} sub={t('admin.dashboard.stats.paidInvoicesSub')} color="var(--color-accent)" />
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
            <DataTable
              keyExtractor={(c: Metrics['topCompanies'][number]) => c.id}
              total={metrics.topCompanies.length}
              page={1}
              limit={Math.max(metrics.topCompanies.length, 1)}
              onPageChange={() => {}}
              data={metrics.topCompanies}
              columns={[
                {
                  key: 'name',
                  label: t('admin.dashboard.companyTable.company'),
                  render: (c) => (
                    <div className={styles.cellWithAvatar}>
                      <Avatar name={c.name} />
                      <span className={styles.cellPrimary}>{c.name}</span>
                    </div>
                  ),
                },
                {
                  key: 'plan',
                  label: t('admin.dashboard.companyTable.plan'),
                  align: 'center',
                  render: (c) => (
                    <Badge variant={TIER_VARIANT[c.tier] || 'neutral'} size="sm">
                      {c.tier === 'free' ? t('admin.dashboard.companyTable.freeTier') : c.plan}
                    </Badge>
                  ),
                },
                { key: 'users', label: t('admin.dashboard.companyTable.users'), align: 'right' },
                { key: 'vehicles', label: t('admin.dashboard.companyTable.vehicles'), align: 'right' },
                { key: 'deliveries', label: t('admin.dashboard.companyTable.deliveries'), align: 'right' },
              ]}
            />
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
              <Input
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                placeholder={t('admin.dashboard.tenantsTab.search')}
                prefixIcon={<Search size={14} />}
                aria-label={t('admin.dashboard.tenantsTab.search')}
              />
            </div>
          </div>
          <DataTable
            keyExtractor={(tenant: Tenant) => tenant.id}
            total={filteredTenants.length}
            page={1}
            limit={Math.max(filteredTenants.length, 1)}
            onPageChange={() => {}}
            data={filteredTenants}
            columns={[
              {
                key: 'name',
                label: t('admin.dashboard.companyTable.company'),
                render: (tenant) => (
                  <div className={styles.cellWithAvatar}>
                    <Avatar name={tenant.name} />
                    <span className={styles.cellPrimary}>{tenant.name}</span>
                  </div>
                ),
              },
              {
                key: 'contact',
                label: t('admin.dashboard.tenantsTab.contact'),
                render: (tenant) => (
                  <span className={styles.tableEllipsis}>{tenant.email || tenant.users[0]?.email || '—'}</span>
                ),
              },
              {
                key: 'plan',
                label: t('admin.dashboard.tenantsTab.plan'),
                align: 'center',
                render: (tenant) => (
                  tenant.subscription ? (
                    <Badge variant={TIER_VARIANT[tenant.subscription.plan.tier] || 'neutral'} size="sm">
                      {tenant.subscription.plan.name}
                    </Badge>
                  ) : <span>—</span>
                ),
              },
              { key: 'users', label: t('admin.dashboard.tenantsTab.users'), align: 'right', render: (tenant) => tenant._count.users },
              { key: 'vehicles', label: t('admin.dashboard.tenantsTab.vehicles'), align: 'right', render: (tenant) => tenant._count.vehicles },
              { key: 'deliveries', label: t('admin.dashboard.tenantsTab.deliveries'), align: 'right', render: (tenant) => tenant._count.deliveries },
              { key: 'createdAt', label: t('admin.dashboard.tenantsTab.createdDate'), render: (tenant) => formatDate(tenant.createdAt) },
              {
                key: 'actions',
                label: t('admin.dashboard.tenantsTab.actions'),
                align: 'center',
                render: (tenant) => (
                  <div className={styles.actionsRow}>
                    <button
                      onClick={() => handleImpersonate(tenant.id)}
                      title={t('admin.dashboard.tenantsTab.impersonate')}
                      aria-label={t('admin.dashboard.tenantsTab.impersonate')}
                      className={styles.iconBtn}
                      style={{ color: 'var(--color-accent)' }}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      onClick={() => handleToggleTenant(tenant.id)}
                      title={t('admin.dashboard.tenantsTab.toggle')}
                      aria-label={t('admin.dashboard.tenantsTab.toggle')}
                      className={styles.iconBtn}
                      style={{ color: 'var(--color-red)' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}

      {!loading && tab === 'audit' && auditLogs && (
        <div className={styles.sectionCard}>
          <div className={styles.sectionCardHeader}>
            <h3 className={styles.sectionTitle}>
              {t('admin.dashboard.auditTab.title', { count: auditLogs.total })}
            </h3>
          </div>
          <DataTable
            keyExtractor={(log: AuditLog) => log.id}
            total={auditLogs.total}
            page={auditPage}
            limit={20}
            onPageChange={setAuditPage}
            data={auditLogs.data}
            columns={[
              {
                key: 'admin',
                label: t('admin.dashboard.auditTab.admin'),
                render: (log) => <span className={styles.cellPrimary}>{log.admin.firstName} {log.admin.lastName}</span>,
              },
              {
                key: 'action',
                label: t('admin.dashboard.auditTab.action'),
                render: (log) => (
                  <Badge variant={AUDIT_ACTION_VARIANT[log.action] || 'neutral'} size="sm">
                    {log.action === 'login' ? t('admin.dashboard.auditActions.login') :
                     log.action === 'login_2fa_required' ? t('admin.dashboard.auditActions.login2faRequired') :
                     log.action === 'login_success' ? t('admin.dashboard.auditActions.loginSuccess') :
                     log.action === 'impersonate' ? t('admin.dashboard.auditActions.impersonate') :
                     log.action === 'tenant_toggle' ? t('admin.dashboard.auditActions.tenantToggle') :
                     log.action === 'logout' ? t('admin.dashboard.auditActions.logout') : log.action}
                  </Badge>
                ),
              },
              {
                key: 'target',
                label: t('admin.dashboard.auditTab.target'),
                render: (log) => (
                  <span className={styles.tableCellSecondary}>
                    {log.targetCompany?.name || (log.metadata?.impersonatedAs ? `→ ${log.metadata.impersonatedAs}` : '—')}
                  </span>
                ),
              },
              {
                key: 'ip',
                label: t('admin.dashboard.auditTab.ip'),
                render: (log) => <span className={styles.tableCellSecondary}>{log.ip || '—'}</span>,
              },
              {
                key: 'createdAt',
                label: t('admin.dashboard.auditTab.date'),
                align: 'right',
                render: (log) => formatDateTime(log.createdAt),
              },
            ]}
          />
        </div>
      )}

      {!loading && tab === 'admins' && (
        <div>
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionTitle}>
                {t('admin.dashboard.adminsTab.title', { count: admins.length })}
              </h3>
              <Button variant="primary" size="sm" icon={<UserPlus size={14} />} onClick={() => setShowCreateAdmin(true)}>
                {t('admin.dashboard.adminsTab.add')}
              </Button>
            </div>
            <DataTable
              keyExtractor={(a: Admin) => a.id}
              total={admins.length}
              page={1}
              limit={Math.max(admins.length, 1)}
              onPageChange={() => {}}
              data={admins}
              columns={[
                {
                  key: 'name',
                  label: t('admin.dashboard.adminsTab.name'),
                  render: (a) => (
                    <div className={styles.cellWithAvatar}>
                      <Avatar name={`${a.firstName} ${a.lastName}`} />
                      <span className={styles.cellPrimary}>{a.firstName} {a.lastName}</span>
                    </div>
                  ),
                },
                { key: 'email', label: t('admin.dashboard.adminsTab.email') },
                {
                  key: 'tfa',
                  label: t('admin.dashboard.adminsTab.tfa'),
                  align: 'center',
                  render: (a) => (
                    <Badge variant={a.totpEnabled ? 'success' : 'warning'} size="sm">
                      {a.totpEnabled ? t('admin.dashboard.adminsTab.tfaEnabled') : t('admin.dashboard.adminsTab.tfaDisabled')}
                    </Badge>
                  ),
                },
                {
                  key: 'active',
                  label: t('admin.dashboard.adminsTab.active'),
                  align: 'center',
                  render: (a) => (
                    <Badge variant={a.isActive ? 'success' : 'danger'} size="sm">
                      {a.isActive ? t('admin.dashboard.adminsTab.isActiveYes') : t('admin.dashboard.adminsTab.isActiveNo')}
                    </Badge>
                  ),
                },
                {
                  key: 'createdAt',
                  label: t('admin.dashboard.adminsTab.createdDate'),
                  align: 'right',
                  render: (a) => formatDate(a.createdAt),
                },
              ]}
            />
          </div>

          <Modal
            open={showCreateAdmin}
            onClose={() => setShowCreateAdmin(false)}
            title={t('admin.dashboard.createAdmin.title')}
          >
            <form onSubmit={handleCreateAdmin}>
              <div className={styles.formFields}>
                <Input
                  label={t('admin.dashboard.createAdmin.firstName')}
                  value={createForm.firstName}
                  onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })}
                  required
                  fullWidth
                />
                <Input
                  label={t('admin.dashboard.createAdmin.lastName')}
                  value={createForm.lastName}
                  onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })}
                  required
                  fullWidth
                />
                <Input
                  type="email"
                  label={t('admin.dashboard.createAdmin.email')}
                  value={createForm.email}
                  onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                  required
                  fullWidth
                />
                <Input
                  type="password"
                  label={t('admin.dashboard.createAdmin.password')}
                  value={createForm.password}
                  onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                  required
                  minLength={6}
                  fullWidth
                />
              </div>
              <div className={styles.formActions}>
                <Button type="button" variant="ghost" onClick={() => setShowCreateAdmin(false)}>
                  {t('admin.dashboard.createAdmin.cancel')}
                </Button>
                <Button type="submit" variant="primary">
                  {t('admin.dashboard.createAdmin.create')}
                </Button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {!loading && tab === 'payments' && (
        <div>
          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionTitle}>
                {t('admin.dashboard.paymentsTab.proofsTitle', { count: paymentProofs.length })}
              </h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['pending', 'approved', 'rejected'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setProofStatusFilter(s)}
                    className={`${styles.tabBtn} ${proofStatusFilter === s ? styles.tabBtnActive : ''}`}
                  >
                    {t(`admin.dashboard.paymentsTab.status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <DataTable
              keyExtractor={(p: PaymentProofRow) => p.id}
              total={paymentProofs.length}
              page={1}
              limit={Math.max(paymentProofs.length, 1)}
              onPageChange={() => {}}
              data={paymentProofs}
              columns={[
                {
                  key: 'company',
                  label: t('admin.dashboard.paymentsTab.company'),
                  render: (p) => (
                    <div className={styles.cellWithAvatar}>
                      <Avatar name={p.company.name} />
                      <div className={styles.cellStacked}>
                        <span className={styles.cellPrimary}>{p.company.name}</span>
                        <span className={styles.cellStackedSub}>{p.submittedBy.firstName} {p.submittedBy.lastName}</span>
                      </div>
                    </div>
                  ),
                },
                { key: 'plan', label: t('admin.dashboard.paymentsTab.plan'), render: (p) => p.claimedPlan.name },
                {
                  key: 'amount',
                  label: t('admin.dashboard.paymentsTab.amount'),
                  align: 'right',
                  render: (p) => formatAriary(p.claimedAmount),
                },
                { key: 'reference', label: t('admin.dashboard.paymentsTab.reference') },
                {
                  key: 'proof',
                  label: t('admin.dashboard.paymentsTab.proof'),
                  render: (p) => (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      style={{ color: 'var(--color-accent)' }}
                      title={t('admin.dashboard.paymentsTab.viewImage')}
                      aria-label={t('admin.dashboard.paymentsTab.viewImage')}
                      onClick={() => {
                        // L'image exige le JWT admin (Authorization header) — un
                        // <a href> nu ne l'envoie pas. On récupère en blob et on
                        // ouvre un object URL à la place.
                        adminApi
                          .get(`/payment-proofs/${p.id}/image`, { responseType: 'blob' })
                          .then((res) => {
                            const url = URL.createObjectURL(res.data);
                            window.open(url, '_blank');
                          })
                          .catch(() => toast(t('common.error'), 'error'));
                      }}
                    >
                      <ImageIcon size={14} />
                    </button>
                  ),
                },
                { key: 'createdAt', label: t('admin.dashboard.paymentsTab.date'), render: (p) => formatDateTime(p.createdAt) },
                ...(proofStatusFilter === 'pending'
                  ? [{
                      key: 'actions',
                      label: t('admin.dashboard.paymentsTab.actions'),
                      align: 'right' as const,
                      render: (p: PaymentProofRow) => (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="primary" onClick={() => handleApproveProof(p)}>
                            {t('admin.dashboard.paymentsTab.approve')}
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRejectTarget(p)}>
                            {t('admin.dashboard.paymentsTab.reject')}
                          </Button>
                        </div>
                      ),
                    }]
                  : []),
              ]}
            />
          </div>

          <div className={styles.sectionCard}>
            <div className={styles.sectionCardHeader}>
              <h3 className={styles.sectionTitle}>
                {t('admin.dashboard.paymentsTab.methodsTitle')}
              </h3>
              <Button variant="primary" size="sm" onClick={() => setShowAddMethod(true)}>
                {t('admin.dashboard.paymentsTab.addMethod')}
              </Button>
            </div>
            <DataTable
              keyExtractor={(m: PaymentMethodRow) => m.id}
              total={paymentMethods.length}
              page={1}
              limit={Math.max(paymentMethods.length, 1)}
              onPageChange={() => {}}
              data={paymentMethods}
              columns={[
                { key: 'provider', label: t('admin.dashboard.paymentsTab.provider') },
                { key: 'phoneNumber', label: t('admin.dashboard.paymentsTab.phoneNumber') },
                { key: 'holderName', label: t('admin.dashboard.paymentsTab.holderName') },
                {
                  key: 'active',
                  label: t('admin.dashboard.adminsTab.active'),
                  align: 'center',
                  render: (m) => (
                    <Badge variant={m.isActive ? 'success' : 'danger'} size="sm">
                      {m.isActive ? t('admin.dashboard.adminsTab.isActiveYes') : t('admin.dashboard.adminsTab.isActiveNo')}
                    </Badge>
                  ),
                },
                {
                  key: 'toggle',
                  label: '',
                  align: 'right',
                  render: (m) => (
                    <Button size="sm" variant="ghost" onClick={() => toggleMethodActive(m)}>
                      {m.isActive
                        ? t('admin.dashboard.paymentsTab.deactivate')
                        : t('admin.dashboard.paymentsTab.activate')}
                    </Button>
                  ),
                },
              ]}
            />
          </div>

          {/* Code généré à l'approbation — affiché UNE fois, jamais repersisté en clair. */}
          <Modal
            open={!!approveResult}
            onClose={() => setApproveResult(null)}
            title={t('admin.dashboard.paymentsTab.approvedTitle')}
          >
            {approveResult && (
              <div className={styles.formFields}>
                <p>{t('admin.dashboard.paymentsTab.approvedWarning')}</p>
                <div className={styles.codeDisplay}>
                  {approveResult.code}
                </div>
                <Button
                  variant="primary"
                  fullWidth
                  onClick={() => {
                    navigator.clipboard?.writeText(approveResult.code).catch(() => {});
                    toast(t('admin.dashboard.paymentsTab.copied'), 'success');
                  }}
                >
                  {t('admin.dashboard.paymentsTab.copyCode')}
                </Button>
              </div>
            )}
          </Modal>

          <Modal
            open={!!rejectTarget}
            onClose={() => { setRejectTarget(null); setRejectReason(''); }}
            title={t('admin.dashboard.paymentsTab.rejectTitle')}
          >
            <form onSubmit={handleRejectProof}>
              <div className={styles.formFields}>
                <Input
                  label={t('admin.dashboard.paymentsTab.rejectReason')}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                  minLength={3}
                  fullWidth
                />
              </div>
              <div className={styles.formActions}>
                <Button type="button" variant="ghost" onClick={() => { setRejectTarget(null); setRejectReason(''); }}>
                  {t('admin.dashboard.createAdmin.cancel')}
                </Button>
                <Button type="submit" variant="danger">
                  {t('admin.dashboard.paymentsTab.reject')}
                </Button>
              </div>
            </form>
          </Modal>

          <Modal
            open={showAddMethod}
            onClose={() => setShowAddMethod(false)}
            title={t('admin.dashboard.paymentsTab.addMethod')}
          >
            <form onSubmit={handleAddPaymentMethod}>
              <div className={styles.formFields}>
                <label className={styles.formLabel} htmlFor="method-provider">
                  {t('admin.dashboard.paymentsTab.provider')}
                </label>
                <select
                  id="method-provider"
                  value={methodForm.provider}
                  onChange={(e) => setMethodForm({ ...methodForm, provider: e.target.value as 'mvola' | 'orange_money' })}
                  className={styles.selectInput}
                >
                  <option value="orange_money">Orange Money</option>
                  <option value="mvola">Mvola</option>
                </select>
                <Input
                  label={t('admin.dashboard.paymentsTab.phoneNumber')}
                  value={methodForm.phoneNumber}
                  onChange={(e) => setMethodForm({ ...methodForm, phoneNumber: e.target.value })}
                  required
                  fullWidth
                />
                <Input
                  label={t('admin.dashboard.paymentsTab.holderName')}
                  value={methodForm.holderName}
                  onChange={(e) => setMethodForm({ ...methodForm, holderName: e.target.value })}
                  required
                  fullWidth
                />
              </div>
              <div className={styles.formActions}>
                <Button type="button" variant="ghost" onClick={() => setShowAddMethod(false)}>
                  {t('admin.dashboard.createAdmin.cancel')}
                </Button>
                <Button type="submit" variant="primary">
                  {t('admin.dashboard.paymentsTab.addMethod')}
                </Button>
              </div>
            </form>
          </Modal>
        </div>
      )}
      </main>
    </div>
  );
}
