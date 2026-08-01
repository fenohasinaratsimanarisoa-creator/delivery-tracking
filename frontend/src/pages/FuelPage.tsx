import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Trash2 } from 'lucide-react';
import api from '../services/api/client';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatAriary } from '../services/formatAriary';
import type { FuelLog, Vehicle } from '../types';
import styles from './FuelPage.module.css';

type ApiError = { response?: { data?: { message?: string } } };

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
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'manual' | 'gps'>('manual');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<FuelLog | null>(null);
  const [deleting, setDeleting] = useState<FuelLog | null>(null);
  const [form, setForm] = useState({
    vehicleId: '', liters: '', kilometers: '', cost: '', fillDate: '', notes: '',
  });
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

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles', 'list'],
    queryFn: () => api.get('/vehicles/list').then((r) => r.data),
    staleTime: 30000,
  });

  const generateMutation = useMutation({
    mutationFn: (date: string) =>
      api.post('/fuel-consumption/daily-reports/generate', { date }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-daily-reports', reportDate] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/fuel-consumption/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption'] });
      toast(t('fuel.updateSuccess'));
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.updateError'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-consumption/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption'] });
      toast(t('fuel.deleteSuccess'));
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.deleteError'), 'error');
      setDeleting(null);
    },
  });

  const openEdit = (l: FuelLog) => {
    setEditing(l);
    setForm({
      vehicleId: l.vehicleId ?? l.vehicle?.id ?? '',
      liters: String(l.liters),
      kilometers: String(l.kilometers),
      cost: String(l.cost),
      fillDate: l.fillDate.slice(0, 10),
      notes: l.notes ?? '',
    });
  };

  const saveEdit = () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      liters: Number(form.liters),
      kilometers: Number(form.kilometers),
      cost: Number(form.cost),
      fillDate: new Date(form.fillDate).toISOString(),
      vehicleId: form.vehicleId,
    };
    if (form.notes.trim()) payload.notes = form.notes.trim();
    updateMutation.mutate({ id: editing.id, payload });
  };

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
                    <th className={styles.thActions}>{t('common.actions')}</th>
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
                      <td className={styles.td}>
                        <div className={styles.actionsRow}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => openEdit(l)}
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.danger}`}
                            onClick={() => setDeleting(l)}
                            title={t('common.delete')}
                            aria-label={t('common.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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

      <EntityDialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t('fuel.editTitle')}
        footer={
          <DialogSubmitBar
            loading={updateMutation.isPending}
            onCancel={() => setEditing(null)}
            submitLabel={t('common.save')}
            form="fuel-edit-form"
          />
        }
      >
        <form
          id="fuel-edit-form"
          onSubmit={(e) => { e.preventDefault(); saveEdit(); }}
        >
          <DialogSection title={t('fuel.editDetails')}>
            <DialogField label={t('fuel.table.vehicle')} required>
              <select
                className="dialog-select"
                value={form.vehicleId}
                onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
              >
                {(vehicles ?? []).map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.licensePlate})
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField label={t('fuel.table.liters')} required>
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.liters}
                onChange={(e) => setForm({ ...form, liters: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.table.km')} required>
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.kilometers}
                onChange={(e) => setForm({ ...form, kilometers: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.table.cost')} required>
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.date')} required>
              <input
                className="dialog-input"
                type="date"
                value={form.fillDate}
                onChange={(e) => setForm({ ...form, fillDate: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.notes')}>
              <input
                className="dialog-input"
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </DialogField>
          </DialogSection>
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleting}
        title={t('fuel.confirmDeleteTitle')}
        message={
          deleting
            ? `${t('fuel.confirmDeleteMessage')} (${deleting.vehicle?.licensePlate ?? deleting.vehicleId}, ${new Date(deleting.fillDate).toLocaleDateString(i18n.language)})`
            : ''
        }
        variant="danger"
        confirmLabel={t('common.delete')}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
