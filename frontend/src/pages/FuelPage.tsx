import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../services/api/client';
import type { FuelLog } from '../types';

const thStyle: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '0.85rem' };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '0.9rem' };
const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  background: '#fff',
});
const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 20px', border: 'none', cursor: 'pointer',
  fontWeight: active ? 700 : 400,
  borderBottom: active ? '2px solid #007bff' : '2px solid transparent',
  color: active ? '#000' : '#666',
  background: 'none', fontSize: '0.9rem',
});

export default function FuelPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'manual' | 'gps'>('manual');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['fuel-consumption', page],
    queryFn: () => api.get(`/fuel-consumption?page=${page}&limit=${limit}`).then((r) => r.data),
  });

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ['fuel-daily-reports', reportDate],
    queryFn: () => api.get(`/fuel-consumption/daily-reports?date=${reportDate}`).then((r) => r.data ?? r ?? []),
    enabled: tab === 'gps',
  });

  const generateMutation = useMutation({
    mutationFn: (date: string) =>
      api.post('/fuel-consumption/daily-reports/generate', { date }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-daily-reports', reportDate] });
    },
  });

  const entries: FuelLog[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit, totalPages: 1 };
  const reportList: any[] = reports ?? [];

  if (isLoading || reportsLoading) {
    return (
      <div style={{ padding: 20 }}>
        <h1>{t('fuel.title')}</h1>
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          <button style={tabStyle(tab === 'manual')} onClick={() => setTab('manual')}>{t('fuel.tabManual')}</button>
          <button style={tabStyle(tab === 'gps')} onClick={() => setTab('gps')}>{t('fuel.tabGps')}</button>
        </div>
        <div style={{ height: 300, background: '#eee', borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <h1>{t('fuel.title')}</h1>
        <p style={{ color: '#c00' }}>{t('fuel.error')}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>{t('fuel.title')}</h1>

      <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
        <button style={tabStyle(tab === 'manual')} onClick={() => setTab('manual')}>{t('fuel.tabManual')}</button>
        <button style={tabStyle(tab === 'gps')} onClick={() => setTab('gps')}>{t('fuel.tabGps')}</button>
      </div>

      {/* Saisie manuelle */}
      {tab === 'manual' && (
        <>
          {entries.length === 0 && (
            <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>
              {t('fuel.empty')}
            </p>
          )}

          {entries.length > 0 && (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                    <th style={thStyle}>{t('fuel.table.vehicle')}</th>
                    <th style={thStyle}>{t('fuel.table.liters')}</th>
                    <th style={thStyle}>{t('fuel.table.km')}</th>
                    <th style={thStyle}>{t('fuel.table.consumption')}</th>
                    <th style={thStyle}>{t('fuel.table.cost')}</th>
                    <th style={thStyle}>{t('fuel.table.date')}</th>
                    <th style={thStyle}>{t('fuel.table.anomaly')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((l) => (
                    <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>{l.vehicle?.licensePlate ?? '-'}</td>
                      <td style={tdStyle}>{l.liters}</td>
                      <td style={tdStyle}>{l.kilometers}</td>
                      <td style={tdStyle}>{l.calculatedConsumption?.toFixed(1) ?? '-'}</td>
                      <td style={tdStyle}>{l.cost.toFixed(2)} €</td>
                      <td style={tdStyle}>{new Date(l.fillDate).toLocaleDateString()}</td>
                      <td style={tdStyle}>
                        {l.anomalyFlag
                          ? <span style={{ color: '#dc3545', fontWeight: 600 }}>{t('fuel.anomaly')}</span>
                          : <span style={{ color: '#28a745' }}>{t('fuel.normal')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {meta.totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
                  <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pageBtnStyle(page <= 1)}>←</button>
                  {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
                    <button key={p} onClick={() => setPage(p)} style={{
                      ...pageBtnStyle(false),
                      fontWeight: p === page ? 700 : 400,
                      background: p === page ? '#007bff' : '#fff',
                      color: p === page ? '#fff' : '#333',
                    }}>{p}</button>
                  ))}
                  <button disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)} style={pageBtnStyle(page >= meta.totalPages)}>→</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Rapport GPS */}
      {tab === 'gps' && (
        <div>
          <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
            {t('fuel.gpsHelp')}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 500 }}>{t('fuel.date')} :</label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.85rem' }}
            />
            <button
              onClick={() => generateMutation.mutate(reportDate)}
              disabled={generateMutation.isPending}
              style={{
                padding: '6px 16px', border: 'none', borderRadius: 4,
                background: generateMutation.isPending ? '#999' : '#007bff',
                color: '#fff', cursor: generateMutation.isPending ? 'default' : 'pointer',
                fontSize: '0.85rem', fontWeight: 500,
              }}
            >
              {generateMutation.isPending ? t('fuel.generating') : t('fuel.generateReport')}
            </button>
          </div>

          {generateMutation.isSuccess && (
            <p style={{ color: '#28a745', fontSize: '0.85rem', marginBottom: 12 }}>
              {t('fuel.generateSuccess')}
            </p>
          )}

          {generateMutation.isError && (
            <p style={{ color: '#dc3545', fontSize: '0.85rem', marginBottom: 12 }}>
              {t('fuel.generateError')}
            </p>
          )}

          {reportList.length === 0 && (
            <p style={{ color: '#888', textAlign: 'center', padding: 40 }}>
              {t('fuel.gpsEmpty')}
            </p>
          )}

          {reportList.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                  <th style={thStyle}>{t('fuel.table.driver')}</th>
                  <th style={thStyle}>{t('fuel.table.vehicle')}</th>
                  <th style={thStyle}>{t('fuel.gpsDistance')}</th>
                  <th style={thStyle}>{t('fuel.table.consumption')}</th>
                  <th style={thStyle}>{t('fuel.estimatedCost')}</th>
                  <th style={thStyle}>{t('fuel.table.date')}</th>
                </tr>
              </thead>
              <tbody>
                {reportList.map((r: any, i: number) => (
                  <tr key={r.id || i} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={tdStyle}>{r.driverName}</td>
                    <td style={tdStyle}>{r.vehiclePlate}</td>
                    <td style={tdStyle}>{r.distanceKm?.toFixed(1)} km</td>
                    <td style={tdStyle}>{r.consumptionLPer100Km?.toFixed(1) ?? '-'} L/100km</td>
                    <td style={tdStyle}>{r.estimatedCost?.toFixed(2)} Ar</td>
                    <td style={tdStyle}>{new Date(r.reportDate).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{
            marginTop: 24, padding: '12px 16px',
            background: '#f8f9fa', borderRadius: 8,
            border: '1px solid #e9ecef', fontSize: '0.8rem', color: '#666', lineHeight: 1.5,
          }}>
            <strong>{t('fuel.helpTitle')} :</strong><br />
            {t('fuel.helpManual')}<br />
            {t('fuel.helpGps')}
          </div>
        </div>
      )}
    </div>
  );
}