import React, { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  BarChart3, Package, CheckCircle2, Clock4, Gauge, Truck, Wifi, Route, Fuel,
  Users, PieChart as PieIcon, Activity, Calendar, FileText, FileSpreadsheet,
} from 'lucide-react';
import Button from '../components/Button';
import Badge from '../components/Badge';
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
  fuelLitersIncludingAnomalies?: number;
  anomalyCount?: number;
  isOnline: boolean;
}

interface FleetReport {
  activeCount: number;
  onlineCount: number;
  totalDistance: number;
  totalFuel: number;
  totalFuelIncludingAnomalies?: number;
  anomalyCount?: number;
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

const COLORS: Record<string, string> = {
  accent: 'var(--color-accent)',
  teal: 'var(--color-teal)',
  red: 'var(--color-red)',
  blue: 'var(--color-blue)',
  purple: 'var(--color-purple)',
  gray: 'var(--color-text-tertiary)',
};

const STATUS_ORDER: Record<string, number> = {
  pending: 0, assigned: 1, in_progress: 2, delivered: 3, failed: 4, cancelled: 5,
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

function useCountUp(target: number, duration = 650) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function KpiCard({ icon, label, value, color, suffix }: {
  icon: React.ReactNode; label: string; value: number; color: string;
  suffix?: string; }) {
  const animated = useCountUp(value);
  return (
    <div className={styles.kpiCard} style={{ ['--kpi' as string]: color }}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}>{icon}</span>
      </div>
      <div className={styles.kpiValue}>
        {formatNumber(animated)}
        {suffix && <span className={styles.kpiSuffix}>{suffix}</span>}
      </div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function GlowCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardHeaderIcon}>{icon}</span>
        <h3 className={styles.cardTitle}>{title}</h3>
      </div>
      <div className={styles.cardBody}>{children}</div>
    </div>
  );
}

function ChartTip({ active, payload, label, labelMap }: {
  active?: boolean; payload?: any[]; label?: string; labelMap?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.chartTip}>
      {label && <div className={styles.chartTipLabel}>{label}</div>}
      {payload.map((p, i) => {
        const name = labelMap && labelMap[p.name] ? labelMap[p.name] : p.name;
        return (
          <div key={i} className={styles.chartTipRow}>
            <span className={styles.chartTipDot} style={{ background: p.color || p.fill }} />
            <span className={styles.chartTipName}>{name}</span>
            <b>{formatNumber(typeof p.value === 'number' ? p.value : 0)}</b>
          </div>
        );
      })}
    </div>
  );
}

function STATUS_COLORS(status: string) {
  switch (status) {
    case 'pending': return COLORS.accent;
    case 'assigned': return COLORS.purple;
    case 'in_progress': return COLORS.blue;
    case 'delivered': return COLORS.teal;
    case 'failed': return COLORS.red;
    case 'cancelled': return COLORS.gray;
    default: return COLORS.gray;
  }
}

function STATUS_LABELS(t: (k: string) => string): Record<string, string> {
  return {
    pending: t('reports.status.pending'),
    assigned: t('reports.status.assigned'),
    in_progress: t('reports.status.in_progress'),
    delivered: t('reports.status.delivered'),
    failed: t('reports.status.failed'),
    cancelled: t('reports.status.cancelled'),
  };
}

function initials(name: string) {
  const parts = name.replace(/[()]/g, '').split(' ').filter(Boolean);
  return `${(parts[0]?.[0] || '').toUpperCase()}${(parts[1]?.[0] || '').toUpperCase()}`;
}

function SkeletonShimmer({ width, height }: { width: number; height: number }) {
  return <div className={styles.shimmer} style={{ width: `${width}%`, height }} />;
}

function KpiSkeleton() {
  return (
    <div className={styles.kpiSkeleton}>
      <SkeletonShimmer width={26} height={18} />
      <SkeletonShimmer width={48} height={26} />
    </div>
  );
}

function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className={styles.skeletonCanvas} style={{ height }}>
      <SkeletonShimmer width={92} height={16} />
      <div className={styles.skeletonBarBlock}>
        {[80, 55, 70, 40, 62, 48, 74].map((h, i) => (
          <SkeletonShimmer key={i} width={8} height={h} />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton() {
  const columns = [26, 18, 12, 12, 12, 12, 14];
  return (
    <div className={styles.skeletonTableWrapper}>
      <div className={styles.skeletonThead}>
        {columns.map((col, i) => (
          <SkeletonShimmer key={`h${i}`} width={col} height={12} />
        ))}
      </div>
      {[1, 2, 3, 4].map((r) => (
        <div key={r} className={styles.skeletonRow}>
          {columns.map((col, c) => (
            <SkeletonShimmer key={`${r}-${c}`} width={col} height={13} />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIconWrap}>{icon}</div>
      <h3 className={styles.emptyTitle}>{title}</h3>
      <p className={styles.emptyDesc}>{hint}</p>
    </div>
  );
}

export default function ReportsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('delivery');
  const [period, setPeriod] = useState<'week' | 'month' | 'custom'>('month');
  const [customFrom, setCustomFrom] = useState(daysAgo(30));
  const [customTo, setCustomTo] = useState(today());

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

  const exportFile = useCallback(async (format: 'pdf' | 'excel') => {
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    // Téléchargement via l'API client (Bearer + base URL dynamique) : window.open
    // brut envoyait une requête SANS cookie/Autorisation → 401 systématique.
    try {
      const res = await api.get(`/reports/export/${format}?type=${tab}&from=${from}&to=${to}`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport-${tab}-${today()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast(t('reports.toast.downloaded', { tab: t(`reports.tabs.${tab}`), format: format.toUpperCase() }));
    } catch {
      // toast géré par l'intercepteur de l'API client
    }
  }, [tab, from, to, toast, t]);

  const reportTabs: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: 'delivery', icon: <Package size={15} />, label: t('reports.tabs.delivery') },
    { key: 'fleet', icon: <Truck size={15} />, label: t('reports.tabs.fleet') },
    { key: 'driver', icon: <Users size={15} />, label: t('reports.tabs.driver') },
  ];

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.titleIconChip}>
          <BarChart3 size={22} />
        </div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('reports.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('reports.title')}</h1>
          <p className={styles.pageSubtitle}>{t('reports.subtitle', { period: t(`reports.period.${period}`) })}</p>
        </div>

        <div className={styles.periodControls}>
          <div className={styles.periodChips}>
            {(['week', 'month', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`${styles.periodChip} ${period === p ? styles.periodChipActive : ''}`}
              >
                {p === 'week' ? t('reports.period.7days') : p === 'month' ? t('reports.period.30days') : t('reports.period.custom')}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className={styles.customPeriodRow}>
              <Calendar size={13} />
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={styles.dateInput} />
              <span className={styles.customPeriodArrow}>→</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={styles.dateInput} />
            </div>
          )}
        </div>
      </div>

      <div className={styles.tabsWrap}>
        {reportTabs.map((rt) => (
          <button
            key={rt.key}
            onClick={() => setTab(rt.key)}
            className={`${styles.tabBtn} ${tab === rt.key ? styles.tabBtnActive : styles.tabBtnInactive}`}
          >
            <span className={styles.tabIcon}>{rt.icon}</span>
            {rt.label}
          </button>
        ))}
        <div className={styles.tabSpacer} />
        <div className={styles.tabActions}>
          <Button variant="secondary" size="sm" icon={<FileText size={14} />} onClick={() => exportFile('pdf')} title={t('reports.export.pdfTitle')}>
            {t('reports.export.pdf')}
          </Button>
          <Button variant="secondary" size="sm" icon={<FileSpreadsheet size={14} />} onClick={() => exportFile('excel')} title={t('reports.export.excelTitle')}>
            {t('reports.export.excel')}
          </Button>
        </div>
      </div>

      <div className={styles.scrollArea}>
        {tab === 'delivery' && <DeliveryReport data={deliveryData} loading={deliveryLoading} />}
        {tab === 'fleet' && <FleetReport data={fleetData} loading={fleetLoading} />}
        {tab === 'driver' && <DriverReport data={driverData} loading={driverLoading} />}
      </div>
    </div>
  );
}

/* ── Rapport Livraisons ────────────────────────────────── */

function DeliveryReport({ data, loading }: { data: DeliveryReport | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.kpiGrid}>
          {[0, 60, 120, 180].map((d) => <KpiSkeleton key={d} />)}
        </div>
        <div className={styles.chartsGrid}>
          <div className={styles.card}><ChartSkeleton height={320} /></div>
          <div className={styles.card}><ChartSkeleton height={320} /></div>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const statusEntries = [...data.statusBreakdown]
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99));
  const statusTotal = statusEntries.reduce((s, e) => s + e.count, 0);
  const hasStatus = statusEntries.length > 0;
  const hasDays = data.byDay.length > 0;
  const labels = STATUS_LABELS(t);

  return (
    <div className={styles.section}>
      <div className={styles.kpiGrid}>
        <KpiCard icon={<Package size={16} />} label={t('reports.kpis.deliveryTotal')} value={data.total} color={COLORS.accent} />
        <KpiCard icon={<CheckCircle2 size={16} />} label={t('reports.kpis.deliveryCompleted')} value={data.completedCount} color={COLORS.teal} />
        <KpiCard icon={<Clock4 size={16} />} label={t('reports.kpis.deliveryOnTime')} value={data.onTimeCount} color={COLORS.blue} />
        <KpiCard icon={<Gauge size={16} />} label={t('reports.kpis.deliveryOnTimeRate')} value={data.onTimeRate} suffix="%" color={data.onTimeRate >= 80 ? COLORS.teal : COLORS.red} />
      </div>

      <div className={styles.chartsGrid}>
        <GlowCard icon={<PieIcon size={14} />} title={t('reports.charts.statusBreakdown')}>
          {hasStatus ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={statusEntries} dataKey="count" nameKey="status"
                    cx="50%" cy="50%" outerRadius={92} innerRadius={54} paddingAngle={3} stroke="transparent">
                    {statusEntries.map((e) => (
                      <Cell key={e.status} fill={STATUS_COLORS(e.status)} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTip labelMap={labels} />} cursor={false} />
                </PieChart>
              </ResponsiveContainer>
              <div className={styles.pieLegend}>
                {statusEntries.map((e) => (
                  <div key={e.status} className={styles.legendRow}>
                    <span className={styles.legendDot} style={{ background: STATUS_COLORS(e.status) }} />
                    <span className={styles.legendName}>{labels[e.status] || e.status}</span>
                    <span className={styles.legendValue}>{formatNumber(e.count)}</span>
                    <span className={styles.legendPct}>{Math.round((e.count / statusTotal) * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState icon={<Package size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
          )}
        </GlowCard>

        <GlowCard icon={<Activity size={14} />} title={t('reports.charts.dailyEvolution')}>
          {hasDays ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.byDay} margin={{ top: 6 }}>
                <defs>
                  <linearGradient id="reportDaily" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }}
                  tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.4 }} />
                <Bar dataKey="count" fill="url(#reportDaily)" radius={[5, 5, 0, 0]} name={t('reports.charts.deliveries')} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Activity size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
          )}
        </GlowCard>
      </div>
    </div>
  );
}

/* ── Rapport Flotte ────────────────────────────────────── */

function FleetReport({ data, loading }: { data: FleetReport | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.kpiGrid}>
          {[0, 60, 120, 180].map((d) => <KpiSkeleton key={d} />)}
        </div>
        <div className={styles.card}><ChartSkeleton height={300} /></div>
        <div className={styles.card}><TableSkeleton /></div>
      </div>
    );
  }
  if (!data) return null;

  const vehicles = data.vehicles || [];
  const hasFleet = vehicles.length > 0;

  return (
    <div className={styles.section}>
      <div className={styles.kpiGrid}>
        <KpiCard icon={<Truck size={16} />} label={t('reports.kpis.fleetActive')} value={data.activeCount} color={COLORS.accent} />
        <KpiCard icon={<Wifi size={16} />} label={t('reports.kpis.fleetOnline')} value={data.onlineCount} color={COLORS.teal} />
        <KpiCard icon={<Route size={16} />} label={t('reports.kpis.fleetDistance')} value={Math.round(data.totalDistance)} suffix="km" color={COLORS.blue} />
        <KpiCard icon={<Fuel size={16} />} label={t('reports.kpis.fleetFuel')} value={Math.round(data.totalFuel)} suffix="L" color={COLORS.purple} />
      </div>

      <GlowCard icon={<Route size={14} />} title={t('reports.charts.distanceByVehicle')}>
        {hasFleet ? (
          <ResponsiveContainer width="100%" height={Math.max(220, vehicles.length * 40)}>
            <BarChart data={vehicles} layout="vertical" margin={{ left: 90 }}>
              <defs>
                <linearGradient id="reportFleetDist" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.95} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="licensePlate" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} width={90} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.4 }} />
              <Bar dataKey="distanceKm" fill="url(#reportFleetDist)" radius={[0, 5, 5, 0]} name="km" maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState icon={<Truck size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
        )}
      </GlowCard>

      <div className={styles.chartsGrid2}>
        <GlowCard icon={<Gauge size={14} />} title={t('reports.charts.consumptionByVehicle')}>
          {hasFleet ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={vehicles} layout="vertical" margin={{ left: 90 }}>
                <defs>
                  <linearGradient id="reportFleetConsump" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--color-teal)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-teal)" stopOpacity={0.95} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="licensePlate" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} width={90} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.4 }} />
                <Bar dataKey="avgConsumption" fill="url(#reportFleetConsump)" radius={[0, 5, 5, 0]} name="L/100km" maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Gauge size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
          )}
        </GlowCard>

        <GlowCard icon={<Package size={14} />} title={t('reports.charts.deliveriesByVehicle')}>
          {hasFleet ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={vehicles} layout="vertical" margin={{ left: 90 }}>
                <defs>
                  <linearGradient id="reportFleetDelivs" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--color-blue)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-blue)" stopOpacity={0.95} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="licensePlate" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} width={90} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.4 }} />
                <Bar dataKey="deliveriesCount" fill="url(#reportFleetDelivs)" radius={[0, 5, 5, 0]} name={t('reports.charts.deliveries')} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState icon={<Package size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
          )}
        </GlowCard>
      </div>

      <GlowCard icon={<Truck size={14} />} title={t('reports.table.vehicles')}>
        {hasFleet ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeadRow}>
                  {[t('reports.table.vehicle'), t('reports.table.licensePlate'), t('reports.table.deliveries'), t('reports.table.distance'), t('reports.table.fuel'), t('reports.table.consumption'), t('reports.table.status')].map((h) => (
                    <th key={h} className={styles.tableHeadCell}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.vehicleId} className={styles.tableRow} style={{ }}>
                    <td className={styles.tableCell}><span className={styles.cellPrimary}>{v.vehicleName}</span></td>
                    <td className={styles.tableCell}><span className={`${styles.cellMono} ${styles.cellSub}`}>{v.licensePlate}</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber}>{formatNumber(v.deliveriesCount)}</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber}>{formatNumber(Math.round(v.distanceKm))} km</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber}>{formatNumber(Math.round(v.fuelLiters))} L</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber}>{v.avgConsumption} L/100km</span></td>
                    <td className={styles.tableCell}>
                      <Badge variant={v.isOnline ? 'teal' : 'neutral'} size="sm" dot>
                        {v.isOnline ? t('reports.table.online') : t('reports.table.offline')}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Truck size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
        )}
      </GlowCard>
    </div>
  );
}

/* ── Rapport Chauffeurs ────────────────────────────────── */

function DriverReport({ data, loading }: { data: DriverReport | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className={styles.section}>
        <div className={styles.kpiGrid}>
          {[0, 60, 120, 180].map((d) => <KpiSkeleton key={d} />)}
        </div>
        <div className={styles.card}><ChartSkeleton height={280} /></div>
        <div className={styles.card}><TableSkeleton /></div>
      </div>
    );
  }
  if (!data) return null;

  const sorted = [...(data.drivers || [])].sort((a, b) => b.totalDeliveries - a.totalDeliveries);
  const hasDrivers = sorted.length > 0;

  return (
    <div className={styles.section}>
      <div className={styles.kpiGrid}>
        <KpiCard icon={<Package size={16} />} label={t('reports.kpis.driverTotal')} value={data.totalDeliveries} color={COLORS.accent} />
        <KpiCard icon={<CheckCircle2 size={16} />} label={t('reports.kpis.driverCompleted')} value={data.totalCompleted} color={COLORS.teal} />
        <KpiCard icon={<Gauge size={16} />} label={t('reports.kpis.driverOnTimeRate')} value={data.overallOnTimeRate} suffix="%" color={data.overallOnTimeRate >= 80 ? COLORS.teal : COLORS.red} />
        <KpiCard icon={<Users size={16} />} label={t('reports.kpis.driverActive')} value={sorted.filter((d) => d.isActive).length} color={COLORS.blue} />
      </div>

      <GlowCard icon={<BarChart3 size={14} />} title={t('reports.charts.deliveriesByDriver')}>
        {hasDrivers ? (
          <>
            <div className={styles.chartLegend}>
              <span className={styles.legendPi}>
                <span className={styles.legendDot} style={{ background: COLORS.teal }} />
                {t('reports.charts.completed')}
              </span>
              <span className={styles.legendPi}>
                <span className={styles.legendDot} style={{ background: COLORS.accent }} />
                {t('reports.charts.inProgress')}
              </span>
              <span className={styles.legendPi}>
                <span className={styles.legendDot} style={{ background: COLORS.red }} />
                {t('reports.charts.failed')}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(220, sorted.length * 42)}>
              <BarChart data={sorted} layout="vertical" margin={{ left: 130 }} barCategoryGap="28%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="driverName" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} width={130} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--color-surface-hover)', opacity: 0.4 }} />
                <Bar dataKey="completedDeliveries" stackId="a" fill={COLORS.teal} radius={[0, 0, 0, 0]} name={t('reports.charts.completed')} maxBarSize={20} />
                <Bar dataKey="inProgressDeliveries" stackId="a" fill={COLORS.accent} radius={[0, 0, 0, 0]} name={t('reports.charts.inProgress')} maxBarSize={20} />
                <Bar dataKey="failedDeliveries" stackId="a" fill={COLORS.red} radius={[0, 5, 5, 0]} name={t('reports.charts.failed')} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <EmptyState icon={<Users size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
        )}
      </GlowCard>

      <GlowCard icon={<Users size={14} />} title={t('reports.table.drivers')}>
        {hasDrivers ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr className={styles.tableHeadRow}>
                  {[t('reports.table.driver'), t('reports.table.phone'), t('reports.table.deliveries'), t('reports.table.completed'), t('reports.table.onTime'), t('reports.table.punctuality'), t('reports.table.failed')].map((h) => (
                    <th key={h} className={styles.tableHeadCell}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.driverId} className={styles.tableRow} style={{ }}>
                    <td className={styles.tableCell}>
                      <span className={styles.driverCell}>
                        <span className={styles.driverAvatar}>{initials(d.driverName)}</span>
                        <span className={styles.driverName}>{d.driverName}</span>
                      </span>
                    </td>
                    <td className={styles.tableCell}><span className={`${styles.cellMono} ${styles.cellSub}`}>{d.phone || '—'}</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber}>{formatNumber(d.totalDeliveries)}</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber} style={{ color: COLORS.teal }}>{formatNumber(d.completedDeliveries)}</span></td>
                    <td className={styles.tableCell}><span className={styles.cellNumber} style={{ color: COLORS.blue }}>{formatNumber(d.onTimeDeliveries)}</span></td>
                    <td className={styles.tableCell}>
                      <span
                        className={styles.ratePill}
                        style={{
                          color: d.onTimeRate >= 80 ? COLORS.teal : d.onTimeRate >= 50 ? COLORS.accent : COLORS.red,
                          background: d.onTimeRate >= 80 ? 'rgba(34,197,94,0.12)' : d.onTimeRate >= 50 ? 'rgba(242,169,60,0.12)' : 'rgba(239,68,68,0.12)',
                        }}
                      >
                        {d.onTimeRate}%
                      </span>
                    </td>
                    <td className={styles.tableCell}>
                      <span className={styles.cellNumber} style={{ color: d.failedDeliveries > 0 ? COLORS.red : 'inherit' }}>
                        {formatNumber(d.failedDeliveries)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Users size={26} />} title={t('reports.empty.noData')} hint={t('reports.empty.hint')} />
        )}
      </GlowCard>
    </div>
  );
}
