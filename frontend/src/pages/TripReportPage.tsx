import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText } from 'lucide-react';
import api from '../services/api/client';
import type { Delivery } from '../types';

interface TripReport {
  delivery: Delivery & { pickupAddress: string; deliveryAddress: string };
  totalDistance: { meters: number; kilometers: number };
  avgSpeedKmh: number;
  totalDurationSec: number;
  stopCount: number;
  positionCount: number;
  postgisDistance: { meters: number; kilometers: number } | null;
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

  const exportPdf = () => {
    window.open(`/api/tracking/report/${selectedId}/export`, '_blank');
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
    <div style={{
      padding: 'var(--space-2xl, 32px)',
      background: 'var(--color-bg, #0B1220)', minHeight: '100vh',
    }}>
      <h1 style={{
        color: 'var(--color-text, #E8ECF3)',
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
        fontSize: 'var(--text-2xl, 1.5rem)', fontWeight: 700,
        marginBottom: 'var(--space-lg, 16px)',
      }}>
        {t('tripReport.title') || 'Trip Report'}
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-md, 12px)', alignItems: 'center', marginBottom: 'var(--space-lg, 16px)' }}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            flex: 1, maxWidth: 400,
            border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
            borderRadius: 'var(--radius-md, 6px)',
            background: 'var(--color-input-bg, #121B2E)',
            color: 'var(--color-text, #E8ECF3)',
            fontSize: 'var(--text-sm, 0.875rem)', outline: 'none',
            fontFamily: 'var(--font-body, Inter, sans-serif)',
          }}
        >
          <option value="">-- Select delivery --</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
        {report && (
          <button
            onClick={exportPdf}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: 'var(--space-sm, 8px) var(--space-lg, 16px)',
              background: 'var(--color-accent, #F2A93C)',
              color: 'var(--color-bg, #0B1220)',
              border: 'none', borderRadius: 'var(--radius-md, 6px)',
              cursor: 'pointer', fontSize: 'var(--text-sm, 0.875rem)',
              fontWeight: 600, fontFamily: 'var(--font-body, Inter, sans-serif)',
            }}
          >
            <FileText size={14} /> {t('tripReport.exportPdf') || 'Export PDF'}
          </button>
        )}
      </div>

      {loading && (
        <div style={{ color: 'var(--color-text-secondary, #9BA6B9)' }}>
          {t('common.loading') || 'Loading...'}
        </div>
      )}

      {report && !loading && (
        <div style={{
          background: 'var(--color-surface, #121B2E)',
          padding: 'var(--space-xl, 20px)',
          borderRadius: 'var(--radius-xl, 12px)',
          border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
          maxWidth: 600,
        }}>
          <h3 style={{
            marginBottom: 'var(--space-lg, 16px)',
            color: 'var(--color-text, #E8ECF3)',
            fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
          }}>
            {report.delivery.title}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 'var(--text-sm, 0.875rem)' }}>
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Status:</strong> {report.delivery.status}</div>
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Positions:</strong> {report.positionCount}</div>
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Distance:</strong> {report.totalDistance.kilometers} km</div>
            {report.postgisDistance && (
              <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Distance (PostGIS):</strong> {report.postgisDistance.kilometers} km</div>
            )}
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Avg Speed:</strong> {report.avgSpeedKmh} km/h</div>
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Duration:</strong> {formatDuration(report.totalDurationSec)}</div>
            <div style={{ color: 'var(--color-text, #E8ECF3)' }}><strong>Stops:</strong> {report.stopCount}</div>
          </div>

          <div style={{
            marginTop: 'var(--space-lg, 16px)',
            fontSize: 'var(--text-sm, 0.85rem)',
            color: 'var(--color-text-secondary, #9BA6B9)',
          }}>
            <div><strong>Pickup:</strong> {report.delivery.pickupAddress}</div>
            <div><strong>Dropoff:</strong> {report.delivery.deliveryAddress}</div>
          </div>
        </div>
      )}
    </div>
  );
}