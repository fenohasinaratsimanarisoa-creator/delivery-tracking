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
import adminApi from '../../services/api/adminClient';
import { getAdminToken, setAdminToken } from '../../services/auth/adminTokenStore';

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

interface AuditLog {
  id: string; action: string; createdAt: string;
  ip: string | null; userAgent: string | null;
  targetCompany: { id: string; name: string } | null;
  targetUserId: string | null;
  admin: { id: string; email: string; firstName: string; lastName: string };
  metadata: any;
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color: string;
}) {
  return (
    <div style={{
      background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--color-border)',
      padding: 'var(--space-lg)', flex: 1, minWidth: 180,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}15`, color,
        }}>
          <Icon size={18} />
        </div>
        <span style={{
          fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)',
          fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {label}
        </span>
      </div>
      <div style={{
        fontSize: 'var(--text-xl)', fontWeight: 700,
        color: 'var(--color-text)', fontFamily: 'var(--font-display)',
      }}>
        {typeof value === 'number' && label.includes('MRR') ? `${value} €` : value}
      </div>
      {sub && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function ImpersonationBanner({ user, onStop }: { user: { email: string; name: string }; onStop: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      background: 'var(--color-warning-muted, #fef3c7)', color: 'var(--color-warning, #d97706)',
      padding: '8px 16px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', fontSize: 'var(--text-sm)',
      borderBottom: '1px solid var(--color-warning-subtle, #fde68a)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Eye size={16} />
        <span>
          {t('admin.dashboard.impersonation', { name: user.name, email: user.email })}
        </span>
      </div>
      <button
        onClick={onStop}
        style={{
          background: 'transparent', border: '1px solid currentColor',
          color: 'inherit', borderRadius: 'var(--radius-sm)',
          padding: '4px 12px', cursor: 'pointer', fontSize: 'var(--text-xs)',
          fontWeight: 600,
        }}
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
  const [impersonating, setImpersonating] = useState<{ email: string; name: string; token: string } | null>(null);
  const [tenantSearch, setTenantSearch] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [admins, setAdmins] = useState<any[]>([]);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', firstName: '', lastName: '' });

  const token = getAdminToken();

  useEffect(() => {
    if (!token) { navigate('/admin/login'); return; }
    loadData();
  }, [token, tab]);

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
    } catch (err: any) {
      if (err?.response?.status === 401) {
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
      setImpersonating({ email: u.email, name: `${u.firstName} ${u.lastName}`, token: res.data.accessToken });
    } catch (err: any) {
      alert(err?.response?.data?.message || t('common.error'));
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
    } catch (err: any) {
      alert(err?.response?.data?.message || t('common.error'));
    }
  };

  const handleLogout = () => {
    setAdminToken(null);
    navigate('/admin/login');
  };

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    t.email?.toLowerCase().includes(tenantSearch.toLowerCase())
  );

  if (!token) return null;

  if (impersonating) {
    return (
      <div>
        <ImpersonationBanner user={impersonating} onStop={stopImpersonating} />
        <iframe
          src={`/dashboard?token=${impersonating.token}`}
          style={{ width: '100%', height: 'calc(100vh - 45px)', border: 'none' }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-xl)', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 'var(--space-xl)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 'var(--radius-md)',
            background: 'var(--color-accent-muted)', color: 'var(--color-accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={22} />
          </div>
          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)',
              fontWeight: 700, color: 'var(--color-text)', margin: 0,
            }}>
              {t('admin.dashboard.title')}
            </h1>
            <p style={{
              fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)',
              margin: 0,
            }}>
              {t('admin.dashboard.subtitle')}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('dashboard')} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: tab === 'dashboard' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
            background: tab === 'dashboard' ? 'var(--color-accent-muted)' : 'transparent',
            color: tab === 'dashboard' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            cursor: 'pointer', fontWeight: 500, fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
          }}>
            <Activity size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('admin.dashboard.tabs.overview')}
          </button>
          <button onClick={() => setTab('tenants')} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: tab === 'tenants' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
            background: tab === 'tenants' ? 'var(--color-accent-muted)' : 'transparent',
            color: tab === 'tenants' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            cursor: 'pointer', fontWeight: 500, fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
          }}>
            <Building2 size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('admin.dashboard.tabs.tenants')}
          </button>
          <button onClick={() => setTab('audit')} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: tab === 'audit' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
            background: tab === 'audit' ? 'var(--color-accent-muted)' : 'transparent',
            color: tab === 'audit' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            cursor: 'pointer', fontWeight: 500, fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
          }}>
            <EyeOff size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('admin.dashboard.tabs.audit')}
          </button>
          <button onClick={() => setTab('admins')} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-md)',
            border: tab === 'admins' ? '2px solid var(--color-accent)' : '1px solid var(--color-border)',
            background: tab === 'admins' ? 'var(--color-accent-muted)' : 'transparent',
            color: tab === 'admins' ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            cursor: 'pointer', fontWeight: 500, fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
          }}>
            <Users size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {t('admin.dashboard.tabs.admins')}
          </button>
          <Button variant="danger" size="sm" icon={<LogOut size={14} />} onClick={handleLogout}>
            {t('admin.dashboard.tabs.logout')}
          </Button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
          {t('common.loading')}
        </div>
      )}

      {!loading && tab === 'dashboard' && metrics && (
        <>
          {/* Stats Grid */}
          <div style={{
            display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap',
            marginBottom: 'var(--space-xl)',
          }}>
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
          <div style={{ display: 'flex', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)', flexWrap: 'wrap' }}>
            <div style={{
              flex: 2, minWidth: 400,
              background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)', padding: 'var(--space-lg)',
            }}>
              <h3 style={{
                fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text)', margin: '0 0 var(--space-md) 0',
              }}>
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

            <div style={{
              flex: 3, minWidth: 400,
              background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)', padding: 'var(--space-lg)',
            }}>
              <h3 style={{
                fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text)', margin: '0 0 var(--space-md) 0',
              }}>
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
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)', overflow: 'hidden',
          }}>
            <div style={{
              padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border-subtle)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{
                fontSize: 'var(--text-sm)', fontWeight: 600,
                color: 'var(--color-text)', margin: 0,
              }}>
                {t('admin.dashboard.topCompanies')}
              </h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '10px var(--space-lg)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.company')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.plan')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.users')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.vehicles')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.deliveries')}</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.topCompanies.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: '10px var(--space-lg)', fontWeight: 500, color: 'var(--color-text)' }}>{c.name}</td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                          background: c.tier === 'enterprise' ? 'var(--color-accent-muted)' : c.tier === 'pro' ? 'var(--color-teal-muted, rgba(45,212,191,0.1))' : 'transparent',
                          color: c.tier === 'enterprise' ? 'var(--color-accent)' : c.tier === 'pro' ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                        }}>
                          {c.tier === 'free' ? t('admin.dashboard.companyTable.freeTier') : c.plan}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{c.users}</td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{c.vehicles}</td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{c.deliveries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading && tab === 'tenants' && (
        <div style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)', overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              {t('admin.dashboard.tenantsTab.title', { count: filteredTenants.length })}
            </h3>
            <div style={{ position: 'relative', width: 280 }}>
              <Search size={14} style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: 'var(--color-text-tertiary)',
              }} />
              <input
                type="text"
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                placeholder={t('admin.dashboard.tenantsTab.search')}
                style={{
                  width: '100%', padding: '6px 10px 6px 30px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-lg)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.companyTable.company')}</th>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.contact')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.plan')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.users')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.vehicles')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.deliveries')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.createdDate')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.tenantsTab.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTenants.map((tenant) => (
                  <tr key={tenant.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: '10px var(--space-lg)', fontWeight: 500, color: 'var(--color-text)' }}>{tenant.name}</td>
                    <td style={{ padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {tenant.email || tenant.users[0]?.email || '—'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        background: tenant.subscription?.plan.tier === 'enterprise' ? 'var(--color-accent-muted)' :
                          tenant.subscription?.plan.tier === 'pro' ? 'rgba(45,212,191,0.1)' : 'transparent',
                        color: tenant.subscription?.plan.tier === 'enterprise' ? 'var(--color-accent)' :
                          tenant.subscription?.plan.tier === 'pro' ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                      }}>
                        {tenant.subscription ? tenant.subscription.plan.name : '—'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{tenant._count.users}</td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{tenant._count.vehicles}</td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>{tenant._count.deliveries}</td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                      {formatDate(tenant.createdAt)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          onClick={() => handleImpersonate(tenant.id)}
                          title={t('admin.dashboard.tenantsTab.impersonate')}
                          style={{
                            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-accent)',
                            cursor: 'pointer', fontSize: 'var(--text-xs)',
                          }}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => handleToggleTenant(tenant.id)}
                          title={t('admin.dashboard.tenantsTab.toggle')}
                          style={{
                            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-red)',
                            cursor: 'pointer', fontSize: 'var(--text-xs)',
                          }}
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
        <div style={{
          background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)', overflow: 'hidden',
        }}>
          <div style={{
            padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border-subtle)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              {t('admin.dashboard.auditTab.title', { count: auditLogs.total })}
            </h3>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-lg)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.auditTab.admin')}</th>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.auditTab.action')}</th>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.auditTab.target')}</th>
                  <th style={{ textAlign: 'left', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.auditTab.ip')}</th>
                  <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.auditTab.date')}</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.data.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <td style={{ padding: '10px var(--space-lg)', color: 'var(--color-text)' }}>
                      {log.admin.firstName} {log.admin.lastName}
                    </td>
                    <td style={{ padding: '10px var(--space-md)' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                        fontSize: 'var(--text-xs)', fontWeight: 600,
                        background: log.action === 'impersonate' ? 'var(--color-accent-muted)' :
                          log.action === 'login' || log.action === 'login_success' ? 'rgba(45,212,191,0.1)' :
                          log.action === 'tenant_toggle' ? 'rgba(251,146,60,0.1)' : 'transparent',
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
                    <td style={{ padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>
                      {log.targetCompany?.name || (log.metadata?.impersonatedAs ? `→ ${log.metadata.impersonatedAs}` : '—')}
                    </td>
                    <td style={{ padding: '10px var(--space-md)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
                      {log.ip || '—'}
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                      {formatDateTime(log.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {auditLogs.totalPages > 1 && (
            <div style={{
              padding: 'var(--space-md) var(--space-lg)',
              borderTop: '1px solid var(--color-border-subtle)',
              display: 'flex', justifyContent: 'center', gap: 8,
            }}>
              {Array.from({ length: auditLogs.totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => { setAuditPage(p); }}
                  style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${p === auditPage ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: p === auditPage ? 'var(--color-accent-muted)' : 'transparent',
                    color: p === auditPage ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                    cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600,
                  }}
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
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)', overflow: 'hidden',
          }}>
            <div style={{
              padding: 'var(--space-lg)', borderBottom: '1px solid var(--color-border-subtle)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                {t('admin.dashboard.adminsTab.title', { count: admins.length })}
              </h3>
              <button
                onClick={() => setShowCreateAdmin(true)}
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-accent)',
                  background: 'var(--color-accent-muted)',
                  color: 'var(--color-accent)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-body)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <UserPlus size={14} />
                {t('admin.dashboard.adminsTab.add')}
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                    <th style={{ textAlign: 'left', padding: '10px var(--space-lg)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.adminsTab.name')}</th>
                    <th style={{ textAlign: 'left', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.adminsTab.email')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.adminsTab.tfa')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.adminsTab.active')}</th>
                    <th style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('admin.dashboard.adminsTab.createdDate')}</th>
                  </tr>
                </thead>
                <tbody>
                  {admins.map((a: any) => (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                      <td style={{ padding: '10px var(--space-lg)', fontWeight: 500, color: 'var(--color-text)' }}>
                        {a.firstName} {a.lastName}
                      </td>
                      <td style={{ padding: '10px var(--space-md)', color: 'var(--color-text-secondary)' }}>
                        {a.email}
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                          background: a.totpEnabled ? 'rgba(45,212,191,0.1)' : 'rgba(251,146,60,0.1)',
                          color: a.totpEnabled ? 'var(--color-teal)' : 'var(--color-orange)',
                        }}>
                          {a.totpEnabled ? t('admin.dashboard.adminsTab.tfaEnabled') : t('admin.dashboard.adminsTab.tfaDisabled')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                          background: a.isActive ? 'rgba(45,212,191,0.1)' : 'rgba(239,68,68,0.1)',
                          color: a.isActive ? 'var(--color-teal)' : 'var(--color-red)',
                        }}>
                          {a.isActive ? t('admin.dashboard.adminsTab.isActiveYes') : t('admin.dashboard.adminsTab.isActiveNo')}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', padding: '10px var(--space-md)', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                        {formatDate(a.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {showCreateAdmin && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 2000,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.4)',
            }} onClick={() => setShowCreateAdmin(false)}>
              <div style={{
                background: 'var(--color-surface)', borderRadius: 'var(--radius-xl)',
                border: '1px solid var(--color-border)',
                padding: 'var(--space-xl)', width: 400, maxWidth: '90vw',
              }} onClick={e => e.stopPropagation()}>
                <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 var(--space-lg) 0' }}>
                  {t('admin.dashboard.createAdmin.title')}
                </h3>
                <form onSubmit={handleCreateAdmin}>
                  <div style={{ marginBottom: 'var(--space-md)' }}>
                    <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      {t('admin.dashboard.createAdmin.firstName')}
                    </label>
                    <input
                      value={createForm.firstName}
                      onChange={e => setCreateForm({ ...createForm, firstName: e.target.value })}
                      required
                      style={{
                        width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)', color: 'var(--color-text)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 'var(--space-md)' }}>
                    <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      {t('admin.dashboard.createAdmin.lastName')}
                    </label>
                    <input
                      value={createForm.lastName}
                      onChange={e => setCreateForm({ ...createForm, lastName: e.target.value })}
                      required
                      style={{
                        width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)', color: 'var(--color-text)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 'var(--space-md)' }}>
                    <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      {t('admin.dashboard.createAdmin.email')}
                    </label>
                    <input
                      type="email"
                      value={createForm.email}
                      onChange={e => setCreateForm({ ...createForm, email: e.target.value })}
                      required
                      style={{
                        width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)', color: 'var(--color-text)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 'var(--space-lg)' }}>
                    <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                      {t('admin.dashboard.createAdmin.password')}
                    </label>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={e => setCreateForm({ ...createForm, password: e.target.value })}
                      required
                      minLength={6}
                      style={{
                        width: '100%', padding: '8px 10px', boxSizing: 'border-box',
                        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                        background: 'var(--color-bg)', color: 'var(--color-text)',
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => setShowCreateAdmin(false)}
                      style={{
                        padding: '8px 16px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'transparent', color: 'var(--color-text-secondary)',
                        cursor: 'pointer', fontWeight: 500, fontSize: 'var(--text-sm)',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      {t('admin.dashboard.createAdmin.cancel')}
                    </button>
                    <button
                      type="submit"
                      style={{
                        padding: '8px 16px', borderRadius: 'var(--radius-md)',
                        border: 'none', background: 'var(--color-accent)',
                        color: '#fff', cursor: 'pointer', fontWeight: 600,
                        fontSize: 'var(--text-sm)', fontFamily: 'var(--font-body)',
                      }}
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
