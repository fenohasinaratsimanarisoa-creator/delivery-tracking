import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../services/api/client';
import type { FuelLog } from '../types';

export default function FuelPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['fuel-consumption', page],
    queryFn: () => api.get(`/fuel-consumption?page=${page}&limit=${limit}`).then((r) => r.data),
  });

  const entries: FuelLog[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit, totalPages: 1 };

  if (isLoading) {
    return (
      <div style={{ padding: 20 }}>
        <h1>{t('fuel.title')}</h1>
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
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                style={pageBtnStyle(page <= 1)}
              >
                ←
              </button>
              {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  style={{
                    ...pageBtnStyle(false),
                    fontWeight: p === page ? 700 : 400,
                    background: p === page ? '#007bff' : '#fff',
                    color: p === page ? '#fff' : '#333',
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(page + 1)}
                style={pageBtnStyle(page >= meta.totalPages)}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, fontSize: '0.85rem' };
const tdStyle: React.CSSProperties = { padding: '10px 12px', fontSize: '0.9rem' };
const pageBtnStyle = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4,
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  background: '#fff',
});
