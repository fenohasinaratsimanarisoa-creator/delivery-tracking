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

function KpiChip({ icon: Icon, label, value, color, delay = 0 }: {
  icon: React.ElementType; label: string; value: string | number; color: string; delay?: number;
}) {
  return (
    <div className="dashboard-overlay-panel" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
      padding: 'var(--space-md) var(--space-lg)',
      minWidth: 160,
      transition: 'background 0.15s, transform 0.15s',
      animation: delay ? `dt-fade-in-up 0.4s ease-out ${delay}s both` : undefined,
    }}>
      <div style={{
        width: 36, height: 36,
        borderRadius: 'var(--radius-lg)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${color}15`,
        color,
      }}>
        <Icon size={18} />
      </div>
      <div>
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.04em', marginBottom: 2,
          fontFamily: 'var(--font-body)',
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 700,
          color: 'var(--color-text)',
          fontFamily: 'var(--font-display)',
          lineHeight: 1.2,
        }}>
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
    <div className="dashboard-overlay-panel" style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-md)',
      padding: 'var(--space-md) var(--space-lg)',
      animation: delay ? `dt-fade-in-up 0.4s ease-out ${delay}s both` : undefined,
    }}>
      <div style={{
        width: 44, height: 44,
        borderRadius: 'var(--radius-full)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${color}20`,
      }}>
        <TrendingUp size={22} style={{ color }} />
      </div>
      <div>
        <div style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          fontWeight: 500, textTransform: 'uppercase',
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-body)',
          marginBottom: 2,
        }}>
          {t('dashboard.reliabilityScore')}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-sm)' }}>
          <span style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 700, fontFamily: 'var(--font-display)', color,
            lineHeight: 1.2,
          }}>
            {score}%
          </span>
          <span style={{
            fontSize: 'var(--text-xs)',
            fontFamily: 'var(--font-mono)',
            color: trend === 'up' ? 'var(--color-teal)' : trend === 'down' ? 'var(--color-red)' : 'var(--color-text-tertiary)',
          }}>
            {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '―'} {t('dashboard.vsPreviousMonth')}
          </span>
        </div>
      </div>
    </div>
  );
}

function MiniChart({ data, delay = 0 }: { data: DeliveryStat[]; delay?: number }) {
  const { t } = useTranslation();
  return (
    <div className="dashboard-overlay-panel" style={{
      padding: 'var(--space-lg)',
      minWidth: 240, maxWidth: 300,
      animation: delay ? `dt-fade-in-up 0.4s ease-out ${delay}s both` : undefined,
    }}>
      <div style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--color-text-secondary)',
        marginBottom: 'var(--space-md)',
        fontFamily: 'var(--font-body)',
      }}>
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
    <div className="dashboard-overlay-panel" style={{
      padding: 'var(--space-lg)',
      minWidth: 240, maxWidth: 300,
      animation: delay ? `dt-fade-in-up 0.4s ease-out ${delay}s both` : undefined,
    }}>
      <div style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em',
        color: 'var(--color-text-secondary)',
        marginBottom: 'var(--space-md)',
        fontFamily: 'var(--font-body)',
      }}>
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
    <div className="dashboard-overlay-panel" style={{
      padding: 'var(--space-lg)',
      minWidth: 240, maxWidth: 320,
      maxHeight: 260,
      display: 'flex', flexDirection: 'column',
      animation: delay ? `dt-fade-in-up 0.4s ease-out ${delay}s both` : undefined,
    }}>
      <div style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em', color: 'var(--color-text-secondary)',
        marginBottom: 'var(--space-md)', fontFamily: 'var(--font-body)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{t('dashboard.recentDeliveries')}</span>
        {deliveries.length > 0 && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
            {deliveries.length}
          </span>
        )}
      </div>
      {deliveries.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 'var(--space-xl) 0',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--text-sm)',
        }}>
          {t('dashboard.noDeliveriesToday')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto', flex: 1 }}>
          {deliveries.map((d: any) => (
            <div key={d.id} style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-sm) var(--space-sm)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
                minWidth: 0, flex: 1,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: 'var(--radius-full)',
                  background: statusColor[d.status] || 'var(--color-text-tertiary)',
                  flexShrink: 0,
                }} />
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap', fontSize: 'var(--text-sm)',
                }}>
                  {d.title}
                </span>
              </div>
              <span style={{
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-tertiary)',
                marginLeft: 'var(--space-sm)',
              }}>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
      padding: 'var(--space-sm) var(--space-md)',
      background: 'var(--color-teal-muted)',
      border: '1px solid var(--color-glass-border)',
      borderRadius: 'var(--radius-full)',
      fontSize: 'var(--text-xs)',
      color: 'var(--color-teal)',
      fontWeight: 500,
      fontFamily: 'var(--font-body)',
      animation: 'dt-fade-in-up 0.4s ease-out',
      whiteSpace: 'nowrap',
    }}>
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
    { icon: Truck, label: t('dashboard.kpis.deliveriesToday'), value: kpis?.deliveriesToday ?? '—', color: 'var(--color-accent)' },
    { icon: CheckCircle, label: t('dashboard.kpis.totalDeliveries'), value: kpis?.totalDeliveries ?? '—', color: 'var(--color-teal)' },
    { icon: MapPin, label: t('dashboard.kpis.activeVehicles'), value: kpis?.activeVehicles ?? '—', color: 'var(--color-accent)' },
    { icon: Clock, label: t('dashboard.kpis.activeDrivers'), value: kpis?.activeDrivers ?? '—', color: 'var(--color-accent)' },
    { icon: AlertTriangle, label: t('dashboard.kpis.anomalies'), value: kpis?.anomalies ?? '—', color: 'var(--color-red)' },
    { icon: Fuel, label: t('dashboard.kpis.avgConsumption'), value: kpis?.fuelStats?.averageConsumption ? `${kpis.fuelStats.averageConsumption.toFixed(1)}` : '—', color: 'var(--color-teal)' },
  ], [kpis]);

  if (loading) {
    return (
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-bg)',
      }}>
        <div style={{
          width: 32, height: 32,
          borderRadius: 'var(--radius-full)',
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          animation: 'dt-spin 0.6s linear infinite',
        }} />
      </div>
    );
  }

  return (
    <>
      <style>{`
        .dashboard-overlay-panel {
          background: var(--color-glass);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid var(--color-glass-border);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow-lg);
        }

        @media (max-width: 768px) {
          .dashboard-desktop-only {
            display: none !important;
          }
          .dashboard-mobile-stack {
            position: static !important;
            pointer-events: auto !important;
          }
        }
        @media (min-width: 769px) {
          .dashboard-mobile-only {
            display: none !important;
          }
        }
      `}</style>

      {/* Desktop layout: full-screen map with floating overlays */}
      <div className="dashboard-desktop-only" style={{
        position: 'relative',
        height: '100%',
        minHeight: '100%',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
          <RealTimeMap />
        </div>

        <div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' }}>
          {/* Top bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            padding: 'var(--space-lg) var(--space-xl)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: 'var(--space-sm)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              <h1 style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'var(--text-xl)',
                fontWeight: 700,
                color: 'var(--color-text)',
                letterSpacing: '-0.02em',
                textShadow: '0 2px 8px rgba(0,0,0,0.5)',
              }}>
                {t('dashboard.title')}
              </h1>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}>
                {formatDateLong(new Date())}
              </div>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center',
              gap: 'var(--space-sm)', pointerEvents: 'auto',
              flexWrap: 'wrap', justifyContent: 'flex-end',
            }}>
              {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
              {kpis && reliability && (
                <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
              )}
            </div>
          </div>

          {/* KPI column - left center */}
          <div style={{
            position: 'absolute', left: 'var(--space-xl)',
            top: '50%', transform: 'translateY(-50%)',
            display: 'flex', flexDirection: 'column',
            gap: 'var(--space-sm)',
            pointerEvents: 'auto',
            maxWidth: 200,
          }}>
            {kpiItems.map((item, i) => (
              <KpiChip key={item.label} {...item} delay={0.1 + i * 0.06} />
            ))}
          </div>

          {/* Charts + Recent deliveries - right side */}
          {!error && (
            <div style={{
              position: 'absolute', right: 'var(--space-xl)',
              top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column',
              gap: 'var(--space-sm)',
              pointerEvents: 'auto',
              alignItems: 'flex-end',
            }}>
              {deliveryStats.length > 0 && <MiniChart data={deliveryStats} delay={0.1} />}
              {fuelData.length > 0 && <FuelMiniChart data={fuelData} delay={0.18} />}
              <RecentDeliveriesMini delay={0.26} />
            </div>
          )}

          {/* Error toast */}
          {error && (
            <div style={{
              position: 'absolute', bottom: 'var(--space-xl)',
              left: '50%', transform: 'translateX(-50%)',
              padding: 'var(--space-md) var(--space-lg)',
              background: 'var(--color-red-muted)',
              border: '1px solid var(--color-red)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--color-red)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
              pointerEvents: 'auto',
            }}>
              {error}
            </div>
          )}

          <OnboardingChecklist />
        </div>
      </div>

      {/* Mobile layout: stacked below map */}
      <div className="dashboard-mobile-only" style={{
        display: 'flex', flexDirection: 'column',
        height: '100%', overflow: 'auto',
      }}>
        <div style={{ height: '50vh', minHeight: 280, position: 'relative' }}>
          <RealTimeMap />
        </div>

        <div className="dashboard-mobile-stack" style={{
          padding: 'var(--space-md)',
          display: 'flex', flexDirection: 'column',
          gap: 'var(--space-sm)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
            padding: 'var(--space-md) 0',
          }}>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-lg)',
              fontWeight: 700, color: 'var(--color-text)',
              flex: 1,
            }}>
              {t('dashboard.title')}
            </h1>
            {perfectMonth && <PerfectMonthBadge month={currentMonth} />}
          </div>

          {kpis && reliability && (
            <ReliabilityScore score={reliability.score} trend={reliability.trend} delay={0.04} />
          )}

          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)',
          }}>
            {kpiItems.slice(0, 3).map((item, i) => (
              <KpiChip key={item.label} {...item} delay={0.1 + i * 0.06} />
            ))}
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)',
          }}>
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
            <div style={{
              padding: 'var(--space-md) var(--space-lg)',
              background: 'var(--color-red-muted)',
              border: '1px solid var(--color-red)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--color-red)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
            }}>
              {error}
            </div>
          )}
        </div>

        <OnboardingChecklist />
      </div>
    </>
  );
}
