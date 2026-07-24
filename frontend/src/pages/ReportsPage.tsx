import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { FileText, FileSpreadsheet, Calendar } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { useToast } from '../components/Toast';

const COLORS = {
  accent: '#F2A93C',
  teal: '#3FA796',
  red: '#E8544C',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  gray: '#6b7280',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  assigned: '#06b6d4',
  in_progress: '#3b82f6',
  delivered: '#22c55e',
  failed: '#ef4444',
  cancelled: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  assigned: 'Assigné',
  in_progress: 'En cours',
  delivered: 'Livré',
  failed: 'Échoué',
  cancelled: 'Annulé',
};

type Tab = 'delivery' | 'fleet' | 'driver';

function today() {
  return new Date().toISOString().split('T')[0];
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function formatNumber(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function Skeleton({ width = '100%', height = 200 }: { width?: string; height?: number }) {
  return (
    <div style={{
      width, height,
      background: 'var(--color-skeleton, #1E2A45)',
      borderRadius: 'var(--radius-lg, 8px)',
      animation: 'dt-shimmer 1.5s infinite linear',
      backgroundImage: 'linear-gradient(90deg, var(--color-skeleton, #1E2A45) 25%, rgba(255,255,255,0.03) 50%, var(--color-skeleton, #1E2A45) 75%)',
      backgroundSize: '200% 100%',
    }} />
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface, #121B2E)',
      border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      borderRadius: 'var(--radius-lg, 8px)',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: 'var(--space-md, 12px) var(--space-lg, 16px)',
        borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      }}>
        <h3 style={{
          fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
          fontSize: 'var(--text-sm, 0.875rem)',
          fontWeight: 600,
          color: 'var(--color-text, #E8ECF3)',
          margin: 0,
        }}>
          {title}
        </h3>
        {action}
      </div>
      <div style={{ padding: 'var(--space-lg, 16px)' }}>
        {children}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: 'var(--space-md, 12px) var(--space-lg, 16px)',
      background: 'var(--color-surface-alt, #182339)',
      borderRadius: 'var(--radius-md, 6px)',
      border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
    }}>
      <div style={{
        fontSize: 'var(--text-xs, 0.75rem)',
        color: 'var(--color-text-secondary, #9BA6B9)',
        marginBottom: 4,
        fontWeight: 500,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'var(--text-xl, 1.25rem)',
        fontWeight: 700,
        fontFamily: 'var(--font-mono, JetBrains Mono, monospace)',
        color: color || 'var(--color-text, #E8ECF3)',
      }}>
        {value}
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'var(--color-surface, #121B2E)',
  border: '1px solid var(--color-border, rgba(242,169,60,0.2))',
  borderRadius: 'var(--radius-md, 6px)',
  fontSize: '0.8rem',
  color: 'var(--color-text, #E8ECF3)',
};

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('delivery');
  const [period, setPeriod] = useState<'week' | 'month' | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState(daysAgo(30));
  const [customTo, setCustomTo] = useState(today());
  const { toast } = useToast();

  const from = period === 'custom' ? customFrom : period === 'week' ? daysAgo(7) : daysAgo(30);
  const to = period === 'custom' ? customTo : today();

  const { data: deliveryData, isLoading: deliveryLoading } = useQuery({
    queryKey: ['reports', 'delivery', from, to],
    queryFn: () => api.get(`/reports/delivery?from=${from}&to=${to}`).then((r) => r.data),
    enabled: tab === 'delivery',
  });

  const { data: fleetData, isLoading: fleetLoading } = useQuery({
    queryKey: ['reports', 'fleet', from, to],
    queryFn: () => api.get(`/reports/fleet?from=${from}&to=${to}`).then((r) => r.data),
    enabled: tab === 'fleet',
  });

  const { data: driverData, isLoading: driverLoading } = useQuery({
    queryKey: ['reports', 'driver', from, to],
    queryFn: () => api.get(`/reports/driver?from=${from}&to=${to}`).then((r) => r.data),
    enabled: tab === 'driver',
  });

  const exportFile = useCallback((format: 'pdf' | 'excel') => {
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    const url = `/api/reports/export/${format}?type=${tab}&from=${from}&to=${to}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-${tab}-${today()}.${ext}`;
    a.click();
    toast(`Rapport ${tab} téléchargé (${format.toUpperCase()})`);
  }, [tab, from, to, toast]);

  const reportTabs: { key: Tab; label: string }[] = [
    { key: 'delivery', label: 'Livraisons' },
    { key: 'fleet', label: 'Flotte' },
    { key: 'driver', label: 'Chauffeurs' },
  ];

  return (
    <div style={{
      padding: 'var(--space-xl, 20px)',
      height: '100%', display: 'flex', flexDirection: 'column',
      color: 'var(--color-text, #E8ECF3)',
      fontFamily: 'var(--font-body, Inter, sans-serif)',
    }}>
      <style>{`
        @keyframes dt-spin { to { transform: rotate(360deg); } }
      `}</style>

      <div className="reports-header" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 'var(--space-lg, 16px)', flexWrap: 'wrap', gap: 'var(--space-md, 12px)',
      }}>
        <div>
          <h1 style={{
            fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
            fontSize: 'var(--text-xl, 1.25rem)', fontWeight: 700,
            color: 'var(--color-text, #E8ECF3)',
            letterSpacing: '-0.02em', margin: 0,
          }}>
            Rapports
          </h1>
          <p style={{
            margin: 'var(--space-xs, 4px) 0 0',
            fontSize: 'var(--text-sm, 0.875rem)',
            color: 'var(--color-text-secondary, #9BA6B9)',
          }}>
            Analysez les performances de votre flotte
          </p>
        </div>

          <div className="reports-period-bar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'flex', gap: 0,
            border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
            borderRadius: 'var(--radius-md, 6px)',
            overflow: 'hidden',
          }}>
            {(['week', 'month', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  background: period === p ? 'var(--color-accent, #F2A93C)' : 'transparent',
                  color: period === p ? 'var(--color-bg, #0B1220)' : 'var(--color-text-secondary, #9BA6B9)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs, 0.75rem)',
                  fontWeight: 600,
                  fontFamily: 'var(--font-body, Inter, sans-serif)',
                  transition: 'background 0.1s',
                }}
              >
                {p === 'week' ? '7 jours' : p === 'month' ? '30 jours' : 'Personnalisé'}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Calendar size={14} style={{ color: 'var(--color-text-tertiary, #7A8BA3)' }} />
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                style={dateInputStyle} />
              <span style={{ color: 'var(--color-text-tertiary, #7A8BA3)', fontSize: '0.75rem' }}>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                style={dateInputStyle} />
            </div>
          )}
        </div>
      </div>

      <div className="reports-tabs-wrap" style={{
        display: 'flex', gap: 'var(--space-sm, 8px)',
        marginBottom: 'var(--space-lg, 16px)',
        borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
      }}>
        {reportTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: 'var(--space-sm, 8px) var(--space-lg, 16px)',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--color-accent, #F2A93C)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t.key ? 'var(--color-accent, #F2A93C)' : 'var(--color-text-secondary, #9BA6B9)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm, 0.875rem)',
              fontWeight: 600,
              fontFamily: 'var(--font-body, Inter, sans-serif)',
              transition: 'color 0.15s, border-color 0.15s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="secondary" size="sm" icon={<FileText size={14} />} onClick={() => exportFile('pdf')} title="Télécharger PDF">
            PDF
          </Button>
          <Button variant="secondary" size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => exportFile('excel')} title="Télécharger Excel">
            Excel
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'delivery' && renderDeliveryReport(deliveryData, deliveryLoading)}
        {tab === 'fleet' && renderFleetReport(fleetData, fleetLoading)}
        {tab === 'driver' && renderDriverReport(driverData, driverLoading)}
      </div>
    </div>
  );
}

const dateInputStyle: React.CSSProperties = {
  padding: '4px 8px',
  background: 'var(--color-input-bg, #121B2E)',
  border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
  borderRadius: 'var(--radius-md, 6px)',
  color: 'var(--color-text, #E8ECF3)',
  fontSize: '0.75rem',
  fontFamily: 'var(--font-body, Inter, sans-serif)',
  outline: 'none',
};

function renderDeliveryReport(data: any, loading: boolean) {
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg, 16px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatBox label="Total livraisons" value={formatNumber(data.total)} color={COLORS.accent} />
        <StatBox label="Taux à l'heure" value={`${data.onTimeRate}%`} color={data.onTimeRate >= 80 ? COLORS.teal : COLORS.red} />
        <StatBox label="Livrées" value={formatNumber(data.completedCount)} color={COLORS.teal} />
        <StatBox label="À l'heure" value={formatNumber(data.onTimeCount)} color={COLORS.blue} />
      </div>

      <div className="reports-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Répartition par statut">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.statusBreakdown} dataKey="count" nameKey="status"
                cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                {data.statusBreakdown.map((entry: any) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || COLORS.gray} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [value, STATUS_LABELS[name] || name]} />
              <Legend formatter={(value: string) => STATUS_LABELS[value] || value} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Évolution par jour">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(232,236,243,0.08))" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }}
                tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={COLORS.accent} radius={[3, 3, 0, 0]} name="Livraisons" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function renderFleetReport(data: any, loading: boolean) {
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg, 16px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatBox label="Véhicules actifs" value={formatNumber(data.activeCount)} color={COLORS.accent} />
        <StatBox label="En ligne" value={formatNumber(data.onlineCount)} color={COLORS.teal} />
        <StatBox label="Distance totale" value={`${formatNumber(Math.round(data.totalDistance))} km`} color={COLORS.blue} />
        <StatBox label="Carburant total" value={`${formatNumber(Math.round(data.totalFuel))} L`} color={COLORS.purple} />
      </div>

      <Card title="Distance par véhicule">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(232,236,243,0.08))" />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
            <YAxis type="category" dataKey="licensePlate"
              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="distanceKm" fill={COLORS.accent} radius={[0, 3, 3, 0]} name="Distance (km)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="reports-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Consommation (L/100km)">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(232,236,243,0.08))" />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
              <YAxis type="category" dataKey="licensePlate"
                tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="avgConsumption" fill={COLORS.teal} radius={[0, 3, 3, 0]} name="L/100km" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Livraisons par véhicule">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(232,236,243,0.08))" />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
              <YAxis type="category" dataKey="licensePlate"
                tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="deliveriesCount" fill={COLORS.blue} radius={[0, 3, 3, 0]} name="Livraisons" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Détail des véhicules">
        <div className="reports-table-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm, 0.875rem)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))' }}>
                {['Véhicule', 'Immatriculation', 'Livraisons', 'Distance', 'Carburant', 'Consommation', 'État'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-secondary, #9BA6B9)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.vehicles.map((v: any) => (
                <tr key={v.vehicleId} style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))' }}>
                  <td style={{ padding: '8px 12px' }}>{v.vehicleName}</td>
                  <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem' }}>{v.licensePlate}</td>
                  <td style={{ padding: '8px 12px' }}>{v.deliveriesCount}</td>
                  <td style={{ padding: '8px 12px' }}>{v.distanceKm} km</td>
                  <td style={{ padding: '8px 12px' }}>{v.fuelLiters} L</td>
                  <td style={{ padding: '8px 12px' }}>{v.avgConsumption} L/100km</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
                      fontSize: '0.7rem', fontWeight: 500,
                      background: v.isOnline ? 'rgba(63,167,150,0.15)' : 'rgba(107,114,128,0.15)',
                      color: v.isOnline ? '#3FA796' : '#9CA3AF',
                    }}>
                      {v.isOnline ? 'En ligne' : 'Hors-ligne'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function renderDriverReport(data: any, loading: boolean) {
  if (loading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  const sorted = [...(data.drivers || [])].sort((a: any, b: any) => b.totalDeliveries - a.totalDeliveries);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg, 16px)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatBox label="Total livraisons" value={formatNumber(data.totalDeliveries)} color={COLORS.accent} />
        <StatBox label="Complétées" value={formatNumber(data.totalCompleted)} color={COLORS.teal} />
        <StatBox label="Ponctualité globale" value={`${data.overallOnTimeRate}%`} color={data.overallOnTimeRate >= 80 ? COLORS.teal : COLORS.red} />
        <StatBox label="Chauffeurs actifs" value={formatNumber(data.drivers.filter((d: any) => d.isActive).length)} color={COLORS.blue} />
      </div>

      <Card title="Livraisons par chauffeur">
        <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 40)}>
          <BarChart data={sorted} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle, rgba(232,236,243,0.08))" />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
            <YAxis type="category" dataKey="driverName"
              tick={{ fontSize: 10, fill: 'var(--color-text-secondary, #9BA6B9)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="completedDeliveries" fill={COLORS.teal} radius={[0, 3, 3, 0]} name="Complétées" stackId="a" />
            <Bar dataKey="inProgressDeliveries" fill={COLORS.accent} radius={[0, 3, 3, 0]} name="En cours" stackId="a" />
            <Bar dataKey="failedDeliveries" fill={COLORS.red} radius={[0, 3, 3, 0]} name="Échouées" stackId="a" />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Détail des chauffeurs">
        <div className="reports-table-wrap" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm, 0.875rem)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))' }}>
                {['Chauffeur', 'Téléphone', 'Livraisons', 'Complétées', 'À l\'heure', 'Ponctualité', 'Échouées'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--color-text-secondary, #9BA6B9)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d: any) => (
                <tr key={d.driverId} style={{ borderBottom: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))' }}>
                  <td style={{ padding: '8px 12px', fontWeight: 500 }}>{d.driverName}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--color-text-secondary, #9BA6B9)', fontSize: '0.75rem' }}>{d.phone || '-'}</td>
                  <td style={{ padding: '8px 12px' }}>{d.totalDeliveries}</td>
                  <td style={{ padding: '8px 12px' }}>{d.completedDeliveries}</td>
                  <td style={{ padding: '8px 12px' }}>{d.onTimeDeliveries}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{
                      color: d.onTimeRate >= 80 ? COLORS.teal : d.onTimeRate >= 50 ? COLORS.accent : COLORS.red,
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '0.8rem',
                    }}>
                      {d.onTimeRate}%
                    </span>
                  </td>
                  <td style={{ padding: '8px 12px', color: d.failedDeliveries > 0 ? COLORS.red : 'inherit' }}>
                    {d.failedDeliveries}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
