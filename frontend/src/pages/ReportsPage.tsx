import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from '../services/i18n/i18n';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { FileText, FileSpreadsheet, Calendar } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import styles from './ReportsPage.module.css';

interface DeliveryReport {
  total: number;
  onTimeRate: number;
  completedCount: number;
  onTimeCount: number;
  statusBreakdown: { status: string; count: number }[];
  byDay: { label: string; count: number }[];
}

interface FleetVehicle {
  vehicleId: string;
  vehicleName: string;
  licensePlate: string;
  deliveriesCount: number;
  distanceKm: number;
  fuelLiters: number;
  avgConsumption: number;
  isOnline: boolean;
}

interface FleetReport {
  activeCount: number;
  onlineCount: number;
  totalDistance: number;
  totalFuel: number;
  vehicles: FleetVehicle[];
}

interface DriverReportEntry {
  driverId: string;
  driverName: string;
  isActive: boolean;
  phone?: string;
  totalDeliveries: number;
  completedDeliveries: number;
  inProgressDeliveries: number;
  failedDeliveries: number;
  onTimeDeliveries: number;
  onTimeRate: number;
}

interface DriverReport {
  totalDeliveries: number;
  totalCompleted: number;
  overallOnTimeRate: number;
  drivers: DriverReportEntry[];
}

const COLORS = {
  accent: 'var(--color-accent)',
  teal: 'var(--color-teal)',
  red: 'var(--color-red)',
  blue: 'var(--color-blue)',
  purple: 'var(--color-purple)',
  gray: 'var(--color-text-tertiary)',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--color-accent)',
  assigned: 'var(--color-blue)',
  in_progress: 'var(--color-blue)',
  delivered: 'var(--color-teal)',
  failed: 'var(--color-red)',
  cancelled: 'var(--color-text-tertiary)',
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
    <div className={styles.skeleton} style={{ width, height }} />
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {action}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} style={{ color: color || 'var(--color-text)' }}>
        {value}
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
};

export default function ReportsPage() {
  const { t } = useTranslation();
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
    toast(t('reports.toast.downloaded', { tab, format: format.toUpperCase() }));
  }, [tab, from, to, toast]);

  const reportTabs: { key: Tab; label: string }[] = [
    { key: 'delivery', label: t('reports.tabs.delivery') },
    { key: 'fleet', label: t('reports.tabs.fleet') },
    { key: 'driver', label: t('reports.tabs.driver') },
  ];

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>{t('reports.title')}</h1>
          <p className={styles.pageSubtitle}>{t('reports.subtitle')}</p>
        </div>

        <div className={styles.periodBar}>
          <div className={styles.periodBtnGroup}>
            {(['week', 'month', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`${styles.periodBtn} ${period === p ? styles.periodBtnActive : styles.periodBtnInactive}`}
              >
                {p === 'week' ? t('reports.period.7days') : p === 'month' ? t('reports.period.30days') : t('reports.period.custom')}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className={styles.customPeriodRow}>
              <Calendar size={14} />
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className={styles.dateInput} />
              <span className={styles.customPeriodArrow}>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className={styles.dateInput} />
            </div>
          )}
        </div>
      </div>

      <div className={styles.tabsWrap}>
        {reportTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`${styles.tabBtn} ${tab === t.key ? styles.tabBtnActive : styles.tabBtnInactive}`}
          >
            {t.label}
          </button>
        ))}
        <div className={styles.tabSpacer} />
        <div className={styles.tabActions}>
          <Button variant="secondary" size="sm" icon={<FileText size={14} />} onClick={() => exportFile('pdf')} title="Télécharger PDF">
            PDF
          </Button>
          <Button variant="secondary" size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => exportFile('excel')} title="Télécharger Excel">
            Excel
          </Button>
        </div>
      </div>

      <div className={styles.scrollArea}>
        {tab === 'delivery' && renderDeliveryReport(deliveryData, deliveryLoading)}
        {tab === 'fleet' && renderFleetReport(fleetData, fleetLoading)}
        {tab === 'driver' && renderDriverReport(driverData, driverLoading)}
      </div>
    </div>
  );
}

function renderDeliveryReport(data: DeliveryReport | undefined, loading: boolean) {
  if (loading) return <div className={styles.loadingContainer}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  return (
    <div className={styles.section}>
      <div className={styles.statsGrid}>
        <StatBox label={i18n.t('reports.driverStats.totalDeliveries')} value={formatNumber(data.total)} color={COLORS.accent} />
        <StatBox label={i18n.t('reports.stats.onTime')} value={`${data.onTimeRate}%`} color={data.onTimeRate >= 80 ? COLORS.teal : COLORS.red} />
        <StatBox label={i18n.t('reports.driverStats.completed')} value={formatNumber(data.completedCount)} color={COLORS.teal} />
        <StatBox label={i18n.t('reports.stats.onTime')} value={formatNumber(data.onTimeCount)} color={COLORS.blue} />
      </div>

      <div className={styles.chartsGrid2}>
        <Card title={i18n.t('reports.charts.statusBreakdown')}>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.statusBreakdown} dataKey="count" nameKey="status"
                cx="50%" cy="50%" outerRadius={90} innerRadius={50}>
                {data.statusBreakdown.map((entry: { status: string; count: number }) => (
                  <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || COLORS.gray} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [value, STATUS_LABELS[name] || name]} />
              <Legend formatter={(value: string) => STATUS_LABELS[value] || value} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title={i18n.t('reports.charts.dailyEvolution')}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }}
                tickFormatter={(v: string) => v.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={COLORS.accent} radius={[3, 3, 0, 0]} name={i18n.t('reports.charts.deliveries')} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}

function renderFleetReport(data: FleetReport | undefined, loading: boolean) {
  if (loading) return <div className={styles.loadingContainer}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  return (
    <div className={styles.section}>
      <div className={styles.statsGrid}>
        <StatBox label={i18n.t('reports.fleetStats.activeVehicles')} value={formatNumber(data.activeCount)} color={COLORS.accent} />
        <StatBox label={i18n.t('reports.fleetStats.online')} value={formatNumber(data.onlineCount)} color={COLORS.teal} />
        <StatBox label={i18n.t('reports.fleetStats.totalDistance')} value={`${formatNumber(Math.round(data.totalDistance))} km`} color={COLORS.blue} />
        <StatBox label={i18n.t('reports.fleetStats.totalFuel')} value={`${formatNumber(Math.round(data.totalFuel))} L`} color={COLORS.purple} />
      </div>

      <Card title="Distance par véhicule">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
            <YAxis type="category" dataKey="licensePlate"
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="distanceKm" fill={COLORS.accent} radius={[0, 3, 3, 0]} name="Distance (km)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className={styles.chartsGrid2}>
        <Card title="Consommation (L/100km)">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
              <YAxis type="category" dataKey="licensePlate"
                tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="avgConsumption" fill={COLORS.teal} radius={[0, 3, 3, 0]} name="L/100km" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Livraisons par véhicule">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.vehicles} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
              <YAxis type="category" dataKey="licensePlate"
                tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="deliveriesCount" fill={COLORS.blue} radius={[0, 3, 3, 0]} name="Livraisons" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Détail des véhicules">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                {['Véhicule', 'Immatriculation', 'Livraisons', 'Distance', 'Carburant', 'Consommation', 'État'].map((h) => (
                  <th key={h} className={styles.tableHeadCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.vehicles.map((v: FleetVehicle) => (
                <tr key={v.vehicleId} className={styles.tableRow}>
                  <td className={styles.tableCell}><span className={styles.cellPrimary}>{v.vehicleName}</span></td>
                  <td className={styles.tableCellMono}>{v.licensePlate}</td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{v.deliveriesCount}</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{v.distanceKm} km</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{v.fuelLiters} L</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{v.avgConsumption} L/100km</span></td>
                  <td className={styles.tableCell}>
                    <span className={`${styles.statusBadge} ${v.isOnline ? styles.statusBadgeOnline : styles.statusBadgeOffline}`}>
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

function renderDriverReport(data: DriverReport | undefined, loading: boolean) {
  if (loading) return <div className={styles.loadingContainer}><Skeleton /><Skeleton height={300} /></div>;
  if (!data) return null;

  const sorted = [...(data.drivers || [])].sort((a: DriverReportEntry, b: DriverReportEntry) => b.totalDeliveries - a.totalDeliveries);

  return (
    <div className={styles.section}>
      <div className={styles.statsGrid}>
        <StatBox label={i18n.t('reports.driverStats.totalDeliveries')} value={formatNumber(data.totalDeliveries)} color={COLORS.accent} />
        <StatBox label={i18n.t('reports.driverStats.completed')} value={formatNumber(data.totalCompleted)} color={COLORS.teal} />
        <StatBox label={i18n.t('reports.driverStats.onTimeGlobal')} value={`${data.overallOnTimeRate}%`} color={data.overallOnTimeRate >= 80 ? COLORS.teal : COLORS.red} />
        <StatBox label={i18n.t('reports.driverStats.activeDrivers')} value={formatNumber(data.drivers.filter((d: DriverReportEntry) => d.isActive).length)} color={COLORS.blue} />
      </div>

      <Card title="Livraisons par chauffeur">
        <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 40)}>
          <BarChart data={sorted} layout="vertical" margin={{ left: 120 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
            <YAxis type="category" dataKey="driverName"
              tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="completedDeliveries" fill={COLORS.teal} radius={[0, 3, 3, 0]} name="Complétées" stackId="a" />
            <Bar dataKey="inProgressDeliveries" fill={COLORS.accent} radius={[0, 3, 3, 0]} name="En cours" stackId="a" />
            <Bar dataKey="failedDeliveries" fill={COLORS.red} radius={[0, 3, 3, 0]} name="Échouées" stackId="a" />
            <Legend />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Détail des chauffeurs">
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr className={styles.tableHeadRow}>
                {['Chauffeur', 'Téléphone', 'Livraisons', 'Complétées', 'À l\'heure', 'Ponctualité', 'Échouées'].map((h) => (
                  <th key={h} className={styles.tableHeadCell}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((d: DriverReportEntry) => (
                <tr key={d.driverId} className={styles.tableRow}>
                  <td className={styles.tableCellBold}><span className={styles.cellPrimary}>{d.driverName}</span></td>
                  <td className={styles.tableCell}><span className={styles.cellSecondary}>{d.phone || '-'}</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{d.totalDeliveries}</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{d.completedDeliveries}</span></td>
                  <td className={styles.tableCell}><span className={styles.cellNumber}>{d.onTimeDeliveries}</span></td>
                  <td className={styles.tableCell}>
                    <span className={styles.punctualityValue} style={{
                      color: d.onTimeRate >= 80 ? COLORS.teal : d.onTimeRate >= 50 ? COLORS.accent : COLORS.red,
                    }}>
                      {d.onTimeRate}%
                    </span>
                  </td>
                  <td className={styles.tableCell}><span className={styles.cellNumber} style={{ color: d.failedDeliveries > 0 ? COLORS.red : 'inherit' }}>
                    {d.failedDeliveries}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
