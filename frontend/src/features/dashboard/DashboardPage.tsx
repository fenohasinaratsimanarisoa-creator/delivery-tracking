import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatDateLong } from '../../services/i18n/formatDate';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';
import { MapPin, Truck, Clock, AlertTriangle, CheckCircle, Fuel, TrendingUp, Sparkles } from 'lucide-react';
import RealTimeMap from '../map/RealTimeMap';
import api from '../../services/api/client';
import type { Kpis, DeliveryStat, FuelChartPoint } from '../../types';
import OnboardingChecklist from './OnboardingChecklist';
import styles from './DashboardPage.module.css';

function KpiChip({ icon: Icon, label, value, color, delay = 0 }: {
  icon: React.ElementType; label: string; value: string | number; color: string; delay?: number;
}) {
  return (
    <div className={`${styles.dashboardOverlayPanel} ${styles.kpiChip}`} style={delay ? { animation: `dt-fade-in-up 0.4s ease-out ${delay}s both` } : undefined}>
      <div className={styles.kpiIconBox} style={{ background: `${color}15`, color }}>
        <Icon size={18} />
      </div>
      <div>
        <div className={styles.kpiLabel}>
          {label}
        </div>
        <div className={styles.kpiValue}>
          {value}
        </div>
      </div>
    </div>
  );
}

function ReliabilityScore({ score, trend, delay = 0 }: { score: number; trend: 'up' | 'down' | 'stable'; delay?: number }) {
  const { t } = useTranslation();
  const color = score >= 95 ? 'var(--color-teal)' : score >= 80 ? 'var(--color-accent)' : 'var(--color-red)';
  return (
    <div className={`${styles.dashboardOverlayPanel} ${styles.reliabilityPanel}`} style={delay ? { animation: `dt-fade-in-up 0.4s ease-out ${delay}s both` } : undefined}>
      <div className={styles.reliabilityIconBox} style={{ background: `${color}20` }}>
        <TrendingUp size={22} style={{ color }} />
      </div>
      <div>
        <div className={styles.reliabilityLabel}>
          {t('dashboard.reliabilityScore')}
        </div>
        <div className={styles.reliabilityScoreRow}>
          <span className={styles.reliabilityScore} style={{ color }}>
            {score}%
          </span>
          <span className={styles.reliabilityTrend} style={{
            color: trend === 'up' ? 'var(--color-teal)' : trend === 'down' ? 'var(--color-red)' : 'var(--color-text-tertiary)',
          }}>
            {trend === 'up' ? '\u25B2' : trend === 'down' ? '\u25BC' : '\u2015'} {t('dashboard.vsPreviousMonth')}
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniChart({ data, delay = 0 }: { data: DeliveryStat[]; delay?: number }) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.dashboardOverlayPanel} ${styles.miniChartPanel}`} style={delay ? { animation: `dt-fade-in-up 0.4s ease-out ${delay}s both` } : undefined}>
      <div className={styles.miniChartTitle}>
        {t('dashboard.charts.deliveryStatus')}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="status" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: 'var(--color-chart-tooltip)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--color-text)' }}
          />
          <Bar dataKey="count" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FuelMiniChart({ data, delay = 0 }: { data: FuelChartPoint[]; delay?: number }) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.dashboardOverlayPanel} ${styles.miniChartPanel}`} style={delay ? { animation: `dt-fade-in-up 0.4s ease-out ${delay}s both` } : undefined}>
      <div className={styles.miniChartTitle}>
        {t('dashboard.charts.consumption')}
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
          <YAxis hide domain={['dataMin - 1', 'dataMax + 1']} />
          <Tooltip
            contentStyle={{
              background: 'var(--color-chart-tooltip)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
            labelStyle={{ color: 'var(--color-text)' }}
          />
          <Line type="monotone" dataKey="consumption" stroke="var(--color-teal)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RecentDeliveriesMini({ delay = 0 }: { delay?: number }) {
  const { t } = useTranslation();
  const [deliveries, setDeliveries] = useState<any[]>([]);
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
    <div className={`${styles.dashboardOverlayPanel} ${styles.recentDeliveriesPanel}`} style={delay ? { animation: `dt-fade-in-up 0.4s ease-out ${delay}s both` } : undefined}>
      <div className={styles.recentDeliveriesHeader}>
        <span>{t('dashboard.recentDeliveries')}</span>
        {deliveries.length > 0 && (
          <span className={styles.recentDeliveriesCount}>
            {deliveries.length}
          </span>
        )}
      </div>
      {deliveries.length === 0 ? (
        <div className={styles.recentDeliveriesEmpty}>
          {t('dashboard.noDeliveriesToday')}
        </div>
      ) : (
        <div className={styles.recentDeliveriesList}>
          {deliveries.map((d: any) => (
            <div key={d.id} className={styles.recentDeliveryItem}>
              <div className={styles.recentDeliveryLeft}>
                <div className={styles.recentDeliveryDot} style={{ background: statusColor[d.status] || 'var(--color-text-tertiary)' }} />
                <span className={styles.recentDeliveryTitle}>
                  {d.title}
                </span>
              </div>
              <span className={styles.recentDeliveryStatus}>
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
  }, []);

  const currentMonth = useMemo(() =>
    formatMonth(new Date()),
  []);

  const perfectMonth = useMemo(() => {
    if (!reliability) return false;
    return reliability.score === 100;
  }, [reliability]);

  const kpiItems = useMemo(() => [
    { icon: Truck, label: t('dashboard.kpis.deliveriesToday'), value: kpis?.deliveriesToday ?? '\u2014', color: 'var(--color-accent)' },
    { icon: CheckCircle, label: t('dashboard.kpis.totalDeliveries'), value: kpis?.totalDeliveries ?? '\u2014', color: 'var(--color-teal)' },
    { icon: MapPin, label: t('dashboard.kpis.activeVehicles'), value: kpis?.activeVehicles ?? '\u2014', color: 'var(--color-accent)' },
    { icon: Clock, label: t('dashboard.kpis.activeDrivers'), value: kpis?.activeDrivers ?? '\u2014', color: 'var(--color-accent)' },
    { icon: AlertTriangle, label: t('dashboard.kpis.anomalies'), value: kpis?.anomalies ?? '\u2014', color: 'var(--color-red)' },
    { icon: Fuel, label: t('dashboard.kpis.avgConsumption'), value: kpis?.fuelStats?.averageConsumption ? `${kpis.fuelStats.averageConsumption.toFixed(1)}` : '\u2014', color: 'var(--color-teal)' },
  ], [kpis]);

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
          <div className={styles.topBar}>
            <div className={styles.topBarLeft}>
              <h1 className={styles.dashboardTitle}>
                {t('dashboard.title')}
              </h1>
              <div className={styles.dashboardDate}>
                {formatDateLong(new Date())}
              </div>
            </div>
            <div className={styles.topBarRight}>
              {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
              {kpis && reliability && (
                <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
              )}
            </div>
          </div>

          {/* KPI column - left center */}
          <div className={styles.kpiColumn}>
            {kpiItems.map((item, i) => (
              <KpiChip key={item.label} {...item} delay={0.1 + i * 0.06} />
            ))}
          </div>

          {/* Charts + Recent deliveries - right side */}
          {!error && (
            <div className={styles.chartsColumn}>
              {deliveryStats.length > 0 && <MiniChart data={deliveryStats} delay={0.1} />}
              {fuelData.length > 0 && <FuelMiniChart data={fuelData} delay={0.18} />}
              <RecentDeliveriesMini delay={0.26} />
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

        <div className={`${styles.mobileStack} ${styles.dashboardMobileStack}`}>
          <div className={styles.mobileTitleRow}>
            <h1 className={styles.mobileTitle}>
              {t('dashboard.title')}
            </h1>
            {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
          </div>

          {kpis && reliability && (
            <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
          )}

          <div className={styles.mobileKpiRow}>
            {kpiItems.slice(0, 3).map((item, i) => (
              <KpiChip key={item.label} {...item} delay={0.1 + i * 0.06} />
            ))}
          </div>
          <div className={styles.mobileKpiRow}>
            {kpiItems.slice(3).map((item, i) => (
              <KpiChip key={item.label} {...item} delay={0.28 + i * 0.06} />
            ))}
          </div>

          {!error && (
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
