import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatDateLong } from '../../services/i18n/formatDate';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, Cell,
} from 'recharts';
import { MapPin, Truck, Clock, AlertTriangle, CheckCircle, Fuel, TrendingUp, Sparkles, Gauge } from 'lucide-react';
import RealTimeMap from '../map/RealTimeMap';
import api from '../../services/api/client';
import type { Kpis, DeliveryStat, FuelChartPoint } from '../../types';
import OnboardingChecklist from './OnboardingChecklist';
import styles from './DashboardPage.module.css';

interface RecentDelivery {
  id: string;
  title: string;
  status: string;
}

function useCountUp(target: number, duration = 700, decimals = 0) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const val = target * eased;
      setValue(decimals > 0 ? parseFloat(val.toFixed(decimals)) : Math.round(val));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, decimals]);
  return value;
}

function KpiCard({ icon: Icon, label, value, color, delay, decimals = 0 }: {
  icon: React.ElementType; label: string; value: number | string | undefined; color: string; delay: number; decimals?: number;
}) {
  const numeric = typeof value === 'number' && isFinite(value);
  const animated = numeric ? useCountUp(value, 700, decimals) : null;
  return (
    <div className={styles.kpiCard} style={{ ['--kpi' as string]: color, animationDelay: `${delay}ms` }}>
      <span className={styles.kpiIcon} style={{ background: `${color}18`, color }}>
        {Icon && <Icon size={15} />}
      </span>
      <div className={styles.kpiBody}>
        <span className={styles.kpiValue}>
          {numeric
            ? (decimals > 0 ? animated?.toFixed(decimals) : animated)
            : (value ?? '\u2014')}
        </span>
        <span className={styles.kpiLabel}>{label}</span>
      </div>
    </div>
  );
}

function ReliabilityScore({ score, trend, delay = 0 }: { score: number; trend: 'up' | 'down' | 'stable'; delay?: number }) {
  const { t } = useTranslation();
  const color = score >= 95 ? 'var(--color-teal)' : score >= 80 ? 'var(--color-accent)' : 'var(--color-red)';
  const r = 17;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(100, score) / 100);
  const trendIcon = trend === 'up' ? '\u25B2' : trend === 'down' ? '\u25BC' : '\u2015';
  const trendColor = trend === 'up' ? 'var(--color-teal)' : trend === 'down' ? 'var(--color-red)' : 'var(--color-text-tertiary)';
  return (
    <div className={styles.reliabilityPanel} style={delay ? { animation: `dt-fade-in-up 0.45s var(--ease-premium, cubic-bezier(0.16,1,0.3,1)) ${delay}s both` } : undefined}>
      <span className={styles.reliabilityRing}>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-border)" strokeWidth="3" />
          <circle
            cx="22" cy="22" r={r} fill="none"
            stroke={color} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={offset}
            transform="rotate(-90 22 22)"
            style={{ transition: 'stroke-dashoffset 0.7s var(--ease-premium, cubic-bezier(0.16,1,0.3,1))' }}
          />
        </svg>
        <TrendingUp size={15} style={{ color, position: 'absolute' }} />
      </span>
      <div className={styles.reliabilityText}>
        <span className={styles.reliabilityLabel}>{t('dashboard.reliabilityScore')}</span>
        <span className={styles.reliabilityScoreRow}>
          <span className={styles.reliabilityScore} style={{ color }}>{score}%</span>
          <span className={styles.reliabilityTrend} style={{ color: trendColor }}>
            {trendIcon} {t('dashboard.vsPreviousMonth')}
          </span>
        </span>
      </div>
    </div>
  );
}

function ChartTooltip() {
  return {
    contentStyle: {
      background: 'var(--color-chart-tooltip)',
      border: '1px solid var(--color-border)',
      borderRadius: 10,
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      boxShadow: 'var(--shadow-lg)',
    },
    labelStyle: { color: 'var(--color-text)', fontWeight: 600 },
    itemStyle: { color: 'var(--color-text)' },
  };
}

const chartTooltip = ChartTooltip();

function MiniChart({ data, delay = 0 }: { data: DeliveryStat[]; delay?: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.chartPanel} style={delay ? { animation: `dt-fade-in-up 0.45s ease-out ${delay}s both` } : undefined}>
      <div className={styles.chartPanelHeader}>
        <span className={styles.chartPanelDot} style={{ background: 'var(--color-accent)' }} />
        <span className={styles.chartPanelTitle}>{t('dashboard.charts.deliveryStatus')}</span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="status" tick={{ fontSize: 9, fill: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip {...chartTooltip} />
          <Bar dataKey="count" radius={[5, 5, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.status} fill={d.status === 'delivered' ? 'var(--color-teal)' : d.status === 'failed' ? 'var(--color-red)' : 'var(--color-accent)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FuelMiniChart({ data, delay = 0 }: { data: FuelChartPoint[]; delay?: number }) {
  const { t } = useTranslation();
  return (
    <div className={styles.chartPanel} style={delay ? { animation: `dt-fade-in-up 0.45s ease-out ${delay}s both` } : undefined}>
      <div className={styles.chartPanelHeader}>
        <span className={styles.chartPanelDot} style={{ background: 'var(--color-teal)' }} />
        <span className={styles.chartPanelTitle}>{t('dashboard.charts.consumption')}</span>
      </div>
      <ResponsiveContainer width="100%" height={110}>
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
          <Tooltip {...chartTooltip} />
          <Line type="monotone" dataKey="consumption" stroke="var(--color-teal)" strokeWidth={2} dot={false}
            strokeLinecap="round" activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentDeliveriesMini({ delay = 0 }: { delay?: number }) {
  const { t } = useTranslation();
  const [deliveries, setDeliveries] = useState<RecentDelivery[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/deliveries?limit=5&sort=createdAt&order=desc')
      .then((r) => { setDeliveries(r.data?.data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const statusColor: Record<string, string> = {
    pending: 'var(--color-text-tertiary)',
    assigned: 'var(--color-accent)',
    in_progress: 'var(--color-status-moving)',
    delivered: 'var(--color-teal)',
    failed: 'var(--color-red)',
    cancelled: 'var(--color-text-tertiary)',
  };

  const statusLabel: Record<string, string> = {
    pending: t('dashboard.status.pending'), assigned: t('dashboard.status.assigned'), in_progress: t('dashboard.status.in_progress'),
    delivered: t('dashboard.status.delivered'), failed: t('dashboard.status.failed'), cancelled: t('dashboard.status.cancelled'),
  };

  if (loading) return null;

  return (
    <div className={styles.recentPanel} style={delay ? { animation: `dt-fade-in-up 0.45s ease-out ${delay}s both` } : undefined}>
      <div className={styles.recentHeader}>
        <span className={styles.recentTitle}>{t('dashboard.recentDeliveries')}</span>
        {deliveries.length > 0 && (
          <span className={styles.recentCount}>{deliveries.length}</span>
        )}
      </div>
      {deliveries.length === 0 ? (
        <div className={styles.recentEmpty}>{t('dashboard.noDeliveriesToday')}</div>
      ) : (
        <div className={styles.recentList}>
          {deliveries.map((d: RecentDelivery) => (
            <div key={d.id} className={styles.recentItem}>
              <span className={styles.recentDot} style={{ background: statusColor[d.status] || 'var(--color-text-tertiary)' }} />
              <span className={styles.recentItemTitle}>{d.title}</span>
              <span
                className={styles.recentStatusPill}
                style={{ color: statusColor[d.status] || 'var(--color-text-tertiary)', borderColor: statusColor[d.status] || 'var(--color-text-tertiary)' }}
              >
                {statusLabel[d.status] || d.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PerfectMonthBadge({ month }: { month: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.perfectMonthBadge}>
      <Sparkles size={14} />
      {t('dashboard.perfectMonth', { month })}
    </div>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [deliveryStats, setDeliveryStats] = useState<DeliveryStat[]>([]);
  const [fuelData, setFuelData] = useState<FuelChartPoint[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reliability, setReliability] = useState<{ score: number; trend: 'up' | 'down' | 'stable' } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [kpiRes, statsRes, fuelRes, relRes] = await Promise.all([
          api.get('/dashboard/kpis'),
          api.get('/dashboard/delivery-stats'),
          api.get('/dashboard/fuel-chart'),
          api.get('/dashboard/reliability-score').catch(() => null),
        ]);
        setKpis(kpiRes.data);
        setDeliveryStats(statsRes.data);
        setFuelData(fuelRes.data);
        if (relRes?.data) setReliability(relRes.data);
      } catch {
        setError(t('dashboard.error'));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [t]);

  const currentMonth = useMemo(() => formatMonth(new Date()), []);

  const perfectMonth = useMemo(() => !!reliability && reliability.score === 100, [reliability]);

  const kpiItems = useMemo(() => [
    { icon: Truck, label: t('dashboard.kpis.deliveriesToday'), value: kpis?.deliveriesToday ?? '\u2014', color: 'var(--color-accent)' },
    { icon: CheckCircle, label: t('dashboard.kpis.totalDeliveries'), value: kpis?.totalDeliveries ?? '\u2014', color: 'var(--color-teal)' },
    { icon: MapPin, label: t('dashboard.kpis.activeVehicles'), value: kpis?.activeVehicles ?? '\u2014', color: 'var(--color-accent)' },
    { icon: Clock, label: t('dashboard.kpis.activeDrivers'), value: kpis?.activeDrivers ?? '\u2014', color: 'var(--color-accent)' },
    { icon: AlertTriangle, label: t('dashboard.kpis.anomalies'), value: kpis?.anomalies ?? '\u2014', color: 'var(--color-red)' },
    { icon: Fuel, label: t('dashboard.kpis.avgConsumption'), value: kpis?.fuelStats?.averageConsumption, color: 'var(--color-teal)', decimals: 1 },
  ], [kpis, t]);

  const anyChart = !error && (deliveryStats.length > 0 || fuelData.length > 0);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner} />
      </div>
    );
  }

  return (
    <>
      {/* Desktop layout: full-screen map with floating overlays */}
      <div className={`${styles.desktopLayout} ${styles.dashboardDesktopOnly}`}>
        <div className={styles.mapContainer}>
          <RealTimeMap />
        </div>

        <div className={styles.overlayContainer}>
          {/* Top bar */}
          <header className={styles.topBar}>
            <div className={styles.topBarLeft}>
              <span className={styles.titleIconChip}><Gauge size={20} /></span>
              <div className={styles.headerText}>
                <span className={styles.kicker}>{t('dashboard.kicker')}</span>
                <h1 className={styles.pageTitle}>{t('dashboard.title')}</h1>
                <span className={styles.dashboardDate}>{formatDateLong(new Date())}</span>
              </div>
            </div>
            <div className={styles.topBarRight}>
              {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
              {kpis && reliability && (
                <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
              )}
            </div>
          </header>

          {/* Left: overview KPI panel */}
          <div className={styles.kpiPanel}>
            <div className={styles.kpiPanelHeader}>
              <span className={styles.kpiPanelDot} />
              <span className={styles.kpiPanelTitle}>{t('dashboard.overviewTitle')}</span>
            </div>
            <div className={styles.kpiGrid}>
              {kpiItems.map((item, i) => (
                <KpiCard key={item.label} {...item} delay={0.1 + i * 0.06} />
              ))}
            </div>
          </div>

          {/* Right column: charts + recent deliveries */}
          {anyChart && (
            <div className={styles.chartsColumn}>
              {deliveryStats.length > 0 && <MiniChart data={deliveryStats} delay={0.14} />}
              {fuelData.length > 0 && <FuelMiniChart data={fuelData} delay={0.18} />}
              <RecentDeliveriesMini delay={0.22} />
            </div>
          )}

          {/* Error toast */}
          {error && (
            <div className={styles.errorToast}>
              {error}
            </div>
          )}

          <OnboardingChecklist />
        </div>
      </div>

      {/* Mobile layout: stacked below map */}
      <div className={`${styles.mobileLayout} ${styles.dashboardMobileOnly}`}>
        <div className={styles.mobileMap}>
          <RealTimeMap />
        </div>

        <div className={styles.mobileStack}>
          <div className={styles.mobileTitleRow}>
            <span className={styles.titleIconChip}><Gauge size={18} /></span>
            <div className={styles.headerText}>
              <span className={styles.kicker}>{t('dashboard.kicker')}</span>
              <h1 className={styles.mobileTitle}>{t('dashboard.title')}</h1>
            </div>
            {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
          </div>

          {kpis && reliability && (
            <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
          )}

          <div className={styles.kpiPanel}>
            <div className={styles.kpiPanelHeader}>
              <span className={styles.kpiPanelDot} />
              <span className={styles.kpiPanelTitle}>{t('dashboard.overviewTitle')}</span>
            </div>
            <div className={styles.kpiGrid}>
              {kpiItems.map((item, i) => (
                <KpiCard key={item.label} {...item} delay={0.08 + i * 0.06} />
              ))}
            </div>
          </div>

          {anyChart && (
            <>
              {deliveryStats.length > 0 && <MiniChart data={deliveryStats} delay={0.1} />}
              {fuelData.length > 0 && <FuelMiniChart data={fuelData} delay={0.18} />}
              <RecentDeliveriesMini delay={0.26} />
            </>
          )}

          {error && (
            <div className={styles.mobileError}>
              {error}
            </div>
          )}
        </div>

        <OnboardingChecklist />
      </div>
    </>
  );
}