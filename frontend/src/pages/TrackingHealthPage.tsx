import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Truck, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import api from '../services/api/client';
import styles from './TrackingHealthPage.module.css';

interface SilenceEntry {
  vehicleId: string;
  licensePlate: string | null;
  brand: string | null;
  model: string | null;
  source: string;
  driverName: string | null;
  deliveryTitle: string | null;
  lastPosition: { latitude: number; longitude: number; timestamp: string } | null;
  silenceMin: number | null;
  thresholdMin: number;
  inSilence: boolean;
  neverConnected: boolean;
  silenceStartedAt: string | null;
}

interface ReliabilityEntry {
  vehicleId: string;
  licensePlate: string | null;
  brand: string | null;
  model: string | null;
  source: string;
  driverName: string | null;
  deliveries: number;
  positions: number;
  coveragePct: number;
  coverageLabel: string;
  gaps: number;
}

export default function TrackingHealthPage() {
  const { t } = useTranslation();
  const [silences, setSilences] = useState<SilenceEntry[]>([]);
  const [reliability, setReliability] = useState<ReliabilityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [sil, rel] = await Promise.all([
        api.get('/tracking/silences'),
        api.get('/tracking/reliability?days=1'),
      ]);
      setSilences(sil.data ?? []);
      setReliability(rel.data?.vehicles ?? []);
      setLastRefresh(new Date());
    } catch {
      // Erreur silencieuse : les toasts de l'intercepteur API s'en chargent.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // Rafraîchissement auto toutes les 60 s : le dispatcher garde l'onglet ouvert
    // toute la journée sans avoir à recharger la page.
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatSilence = (min: number | null) => {
    if (min === null) return '—';
    if (min < 60) return `${Math.round(min)} min`;
    return `${Math.floor(min / 60)}h${Math.round(min % 60).toString().padStart(2, '0')}`;
  };

  const inSilenceCount = silences.filter((s) => s.inSilence || s.neverConnected).length;
  const activeCount = silences.length;

  const coverageColor = (pct: number) => (pct >= 95 ? 'var(--color-teal)' : pct >= 75 ? 'var(--color-accent)' : 'var(--color-red)');
  const coverageLabel = (entry: ReliabilityEntry) =>
    entry.coverageLabel === 'excellent' ? 'Excellente' : entry.coverageLabel === 'bon' ? 'Bonne' : entry.coverageLabel === 'moyen' ? 'Moyenne' : 'Faible';

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.titleIconChip}>
          <Activity size={22} />
        </div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('trackingHealth.kicker') || 'SUPERVISION'}</span>
          <h1 className={styles.pageTitle}>{t('trackingHealth.title') || 'Santé du tracking'}</h1>
          <p className={styles.pageSubtitle}>
            {lastRefresh
              ? `${t('trackingHealth.lastRefresh') || 'Actualisé à'} ${lastRefresh.toLocaleTimeString('fr-FR')} — ${t('trackingHealth.autoRefresh') || 'auto-refresh 60s'}`
              : t('trackingHealth.loadingHint') || 'Chargement…'}
          </p>
        </div>
        <button
          className={styles.refreshBtn}
          onClick={load}
          disabled={refreshing}
          title="Actualiser"
        >
          <RefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
          {t('common.refresh') || 'Actualiser'}
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>
          {t('common.loading') || 'Chargement...'}
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className={styles.kpiGrid}>
            <div className={styles.kpiCard} style={{ ['--kpi' as string]: 'var(--color-accent)' }}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiIcon}><Truck size={16} /></span>
              </div>
              <div className={styles.kpiValue}>{activeCount}</div>
              <div className={styles.kpiLabel}>{t('trackingHealth.vehiclesTracked') || 'Véhicules suivis'}</div>
            </div>
            <div className={styles.kpiCard} style={{ ['--kpi' as string]: inSilenceCount > 0 ? 'var(--color-red)' : 'var(--color-teal)' }}>
              <div className={styles.kpiTop}>
                <span className={styles.kpiIcon}>
                  {inSilenceCount > 0 ? <WifiOff size={16} /> : <Wifi size={16} />}
                </span>
              </div>
              <div className={styles.kpiValue}>{inSilenceCount}</div>
              <div className={styles.kpiLabel}>{t('trackingHealth.inSilence') || 'En silence GPS'}</div>
            </div>
          </div>

          {/* Silences (ancienneté du signal) */}
          <div className={styles.sectionTitle}>
            {t('trackingHealth.silenceTitle') || 'Silences GPS en cours (ancienneté du signal)'}
          </div>
          <div className={styles.tableCard}>
            {silences.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconWrap}><Wifi size={26} /></div>
                <h3 className={styles.emptyTitle}>{t('trackingHealth.noSilence') || 'Aucun véhicule en silence'}</h3>
                <p className={styles.emptyDesc}>
                  {t('trackingHealth.noSilenceHint') || 'Tous les véhicules actifs transmettent leur position.'}
                </p>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr className={styles.tableHeadRow}>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.vehicle') || 'Véhicule'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.driver') || 'Chauffeur'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.source') || 'Source'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.signalAge') || 'Ancienneté signal'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.threshold') || 'Seuil'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.status') || 'État'}</th>
                  </tr>
                </thead>
                <tbody>
                  {silences.map((s) => (
                    <tr key={s.vehicleId} className={styles.tableRow}>
                      <td className={styles.tableCell}>
                        <span className={styles.platePill}>{s.licensePlate || s.vehicleId.slice(0, 8)}</span>
                        {s.brand && <span className={styles.vehicleModel}> {s.brand} {s.model || ''}</span>}
                      </td>
                      <td className={styles.tableCell}>{s.driverName || '—'}</td>
                      <td className={styles.tableCell}>
                        <span className={styles.sourcePill}>
                          {s.source === 'physical_tracker' ? 'Traceur' : 'App'}
                        </span>
                      </td>
                      <td className={styles.tableCell}>
                        <span className={styles.signalAge} style={{ color: s.inSilence ? 'var(--color-red)' : 'var(--color-teal)' }}>
                          {formatSilence(s.silenceMin)}
                        </span>
                        {s.silenceStartedAt && s.inSilence && (
                          <span className={styles.silenceSince}>
                            {t('trackingHealth.since') || 'depuis'}{' '}
                            {new Date(s.silenceStartedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </td>
                      <td className={styles.tableCell}>{s.thresholdMin} min</td>
                      <td className={styles.tableCell}>
                        <span className={`${styles.statusPill} ${s.inSilence ? styles.statusPillOff : styles.statusPillOn}`}>
                          <span className={styles.statusDot} />
                          {s.neverConnected
                            ? (t('trackingHealth.neverConnected') || 'Jamais connecté')
                            : s.inSilence
                              ? (t('trackingHealth.silent') || 'SILENCE')
                              : (t('trackingHealth.ok') || 'OK')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Couverture du jour */}
          <div className={styles.sectionTitle}>
            {t('trackingHealth.coverageTitle') || 'Couverture GPS du jour par véhicule'}
          </div>
          <div className={styles.tableCard}>
            {reliability.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconWrap}><Activity size={26} /></div>
                <h3 className={styles.emptyTitle}>{t('trackingHealth.noCoverage') || 'Aucune livraison terminée aujourd\'hui'}</h3>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr className={styles.tableHeadRow}>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.vehicle') || 'Véhicule'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.driver') || 'Chauffeur'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.deliveries') || 'Livraisons'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.positions') || 'Positions'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.coverage') || 'Couverture'}</th>
                    <th className={styles.tableHeadCell}>{t('trackingHealth.gaps') || 'Trous signalés'}</th>
                  </tr>
                </thead>
                <tbody>
                  {reliability.map((r) => (
                    <tr key={r.vehicleId} className={styles.tableRow}>
                      <td className={styles.tableCell}>
                        <span className={styles.platePill}>{r.licensePlate || r.vehicleId.slice(0, 8)}</span>
                      </td>
                      <td className={styles.tableCell}>{r.driverName || '—'}</td>
                      <td className={styles.tableCell}>{r.deliveries}</td>
                      <td className={styles.tableCell}>{r.positions}</td>
                      <td className={styles.tableCell}>
                        <span className={styles.coveragePill} style={{ color: coverageColor(r.coveragePct) }}>
                          {r.coveragePct}% — {coverageLabel(r)}
                        </span>
                      </td>
                      <td className={styles.tableCell} style={{ color: r.gaps > 0 ? 'var(--color-red)' : 'var(--color-text-tertiary)' }}>
                        {r.gaps > 0 ? `⚠ ${r.gaps}` : '0'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
