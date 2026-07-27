import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../services/api/client';
import { formatAriary } from '../services/formatAriary';
import type { FuelLog } from '../types';
import styles from './FuelPage.module.css';

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
  const { t, i18n } = useTranslation();
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
  interface FuelReport {
    id: string | number;
    driverName?: string;
    vehiclePlate?: string;
    distanceKm?: number;
    consumptionLPer100Km?: number;
    estimatedCost?: number;
    reportDate?: string;
  }
  const reportList: FuelReport[] = reports ?? [];

  if (isLoading || reportsLoading) {
    return (
      <div className={styles.pageContainer}>
        <h1>{t('fuel.title')}</h1>
        <div className={styles.tabsRow}>
          <button style={tabStyle(tab === 'manual')} onClick={() => setTab('manual')}>{t('fuel.tabManual')}</button>
          <button style={tabStyle(tab === 'gps')} onClick={() => setTab('gps')}>{t('fuel.tabGps')}</button>
        </div>
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageContainer}>
        <h1>{t('fuel.title')}</h1>
        <p className={styles.errorText}>{t('fuel.error')}</p>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <h1>{t('fuel.title')}</h1>

      <div className={styles.tabsRow}>
        <button style={tabStyle(tab === 'manual')} onClick={() => setTab('manual')}>{t('fuel.tabManual')}</button>
        <button style={tabStyle(tab === 'gps')} onClick={() => setTab('gps')}>{t('fuel.tabGps')}</button>
      </div>

      {/* Saisie manuelle */}
      {tab === 'manual' && (
        <>
          {entries.length === 0 && (
            <p className={styles.emptyText}>
              {t('fuel.empty')}
            </p>
          )}

          {entries.length > 0 && (
            <>
              <table className={styles.table}>
                <thead>
                  <tr className={styles.headerRow}>
                    <th className={styles.th}>{t('fuel.table.vehicle')}</th>
                    <th className={styles.th}>{t('fuel.table.liters')}</th>
                    <th className={styles.th}>{t('fuel.table.km')}</th>
                    <th className={styles.th}>{t('fuel.table.consumption')}</th>
                    <th className={styles.th}>{t('fuel.table.cost')}</th>
                    <th className={styles.th}>{t('fuel.table.date')}</th>
                    <th className={styles.th}>{t('fuel.table.anomaly')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((l) => (
                    <tr key={l.id} className={styles.dataRow}>
                      <td className={styles.td}>{l.vehicle?.licensePlate ?? '-'}</td>
                      <td className={styles.td}>{l.liters}</td>
                      <td className={styles.td}>{l.kilometers}</td>
                      <td className={styles.td}>{l.calculatedConsumption?.toFixed(1) ?? '-'}</td>
                      <td className={styles.td}>{l.cost.toFixed(2)} €</td>
                      <td className={styles.td}>{new Date(l.fillDate).toLocaleDateString(i18n.language)}</td>
                      <td className={styles.td}>
                        {l.anomalyFlag
                          ? <span className={styles.anomalyBadge}>{t('fuel.anomaly')}</span>
                          : <span className={styles.normalBadge}>{t('fuel.normal')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {meta.totalPages > 1 && (
                <div className={styles.pagination}>
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
          <p className={styles.helpText}>
            {t('fuel.gpsHelp')}
          </p>

          <div className={styles.dateRow}>
            <label className={styles.label}>{t('fuel.date')} :</label>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className={styles.dateInput}
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
            <p className={styles.successText}>
              {t('fuel.generateSuccess')}
            </p>
          )}

          {generateMutation.isError && (
            <p className={styles.errorTextMsg}>
              {t('fuel.generateError')}
            </p>
          )}

          {reportList.length === 0 && (
            <p className={styles.emptyText}>
              {t('fuel.gpsEmpty')}
            </p>
          )}

          {reportList.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr className={styles.headerRow}>
                  <th className={styles.th}>{t('fuel.table.driver')}</th>
                  <th className={styles.th}>{t('fuel.table.vehicle')}</th>
                  <th className={styles.th}>{t('fuel.gpsDistance')}</th>
                  <th className={styles.th}>{t('fuel.table.consumption')}</th>
                  <th className={styles.th}>{t('fuel.estimatedCost')}</th>
                  <th className={styles.th}>{t('fuel.table.date')}</th>
                </tr>
              </thead>
              <tbody>
                {reportList.map((r: FuelReport, i: number) => (
                  <tr key={r.id || i} className={styles.dataRow}>
                    <td className={styles.td}>{r.driverName}</td>
                    <td className={styles.td}>{r.vehiclePlate}</td>
                    <td className={styles.td}>{r.distanceKm?.toFixed(1)} km</td>
                    <td className={styles.td}>{r.consumptionLPer100Km?.toFixed(1) ?? '-'} L/100km</td>
                    <td className={styles.td}>{formatAriary(r.estimatedCost)}</td>
                    <td className={styles.td}>{r.reportDate ? new Date(r.reportDate).toLocaleDateString(i18n.language) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className={styles.helpBox}>
            <strong>{t('fuel.helpTitle')} :</strong><br />
            {t('fuel.helpManual')}<br />
            {t('fuel.helpGps')}
          </div>
        </div>
      )}
    </div>
  );
}