import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import api from '../services/api/client';
import type { Delivery } from '../types';
import styles from './TripReportPage.module.css';

interface TripReport {
  delivery: Delivery & { pickupAddress: string; deliveryAddress: string };
  totalDistance: { meters: number; kilometers: number };
  avgSpeedKmh: number;
  totalDurationSec: number;
  stopCount: number;
  positionCount: number;
  postgisDistance: { meters: number; kilometers: number } | null;
  signalGaps?: { fromTimestamp: string; toTimestamp: string; durationSec: number }[];
  trackingCoveragePct?: number;
}

export default function TripReportPage() {
  const { t } = useTranslation();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [report, setReport] = useState<TripReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/deliveries').then((r) => setDeliveries(r.data?.data ?? r.data ?? []));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    api.get(`/tracking/report/${selectedId}`)
      .then((r) => setReport(r.data))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const [exporting, setExporting] = useState(false);

  const exportPdf = async () => {
    if (!selectedId || exporting) return;
    setExporting(true);
    try {
      const res = await api.get(`/tracking/report/${selectedId}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trip-report-${selectedId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      // toast handled by api interceptor
    } finally {
      setExporting(false);
    }
  };

  const formatDuration = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>
        {t('tripReport.title') || 'Trip Report'}
      </h1>

      <div className={styles.controls}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={styles.select}
        >
          <option value="">-- Select delivery --</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
        {report && (
          <button
            onClick={exportPdf}
            disabled={exporting}
            className={styles.exportBtn}
          >
            <FileText size={14} /> {exporting ? t('common.loading') || '...' : t('tripReport.exportPdf') || 'Export PDF'}
          </button>
        )}
      </div>

      {loading && (
        <div className={styles.loading}>
          {t('common.loading') || 'Loading...'}
        </div>
      )}

      {report && !loading && (
        <div className={styles.reportCard}>
          <h3 className={styles.reportTitle}>
            {report.delivery.title}
          </h3>

          <div className={styles.reportGrid}>
            <div className={styles.reportItem}><strong>Status:</strong> {report.delivery.status}</div>
            <div className={styles.reportItem}><strong>Positions:</strong> {report.positionCount}</div>
            <div className={styles.reportItem}><strong>Distance:</strong> {report.totalDistance.kilometers} km</div>
            {report.postgisDistance && (
              <div className={styles.reportItem}><strong>Distance (PostGIS):</strong> {report.postgisDistance.kilometers} km</div>
            )}
            <div className={styles.reportItem}><strong>Avg Speed:</strong> {report.avgSpeedKmh} km/h</div>
            <div className={styles.reportItem}><strong>Duration:</strong> {formatDuration(report.totalDurationSec)}</div>
            <div className={styles.reportItem}><strong>Stops:</strong> {report.stopCount}</div>
            {report.trackingCoveragePct !== undefined && (
              <div className={styles.reportItem}>
                <strong>Couverture GPS:</strong>{' '}
                <span style={{ color: report.trackingCoveragePct >= 95 ? 'var(--color-teal)' : report.trackingCoveragePct >= 75 ? 'var(--color-accent)' : 'var(--color-red)' }}>
                  {report.trackingCoveragePct}%
                </span>
              </div>
            )}
          </div>

          {report.signalGaps && report.signalGaps.length > 0 && (
            <div className={styles.reportGaps}>
              <strong>Signal GPS interrompu :</strong>
              <ul>
                {report.signalGaps.slice(0, 5).map((gap, i) => {
                  const from = new Date(gap.fromTimestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                  const to = new Date(gap.toTimestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                  return <li key={i}>⚠ {from} → {to} ({Math.round(gap.durationSec / 60)} min sans signal)</li>;
                })}
              </ul>
            </div>
          )}

          <div className={styles.reportFooter}>
            <div><strong>Pickup:</strong> {report.delivery.pickupAddress}</div>
            <div><strong>Dropoff:</strong> {report.delivery.deliveryAddress}</div>
          </div>
        </div>
      )}
    </div>
  );
}
