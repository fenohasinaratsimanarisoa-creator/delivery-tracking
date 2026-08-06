import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Pencil,
  Plus,
  Trash2,
  Fuel,
  Droplets,
  Wallet,
  Gauge,
  AlertTriangle,
  PenLine,
  Radar,
  CircleDollarSign,
  RefreshCw,
  CalendarDays,
  Info,
  Inbox,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import api from '../services/api/client';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { formatAriary } from '../services/formatAriary';
import type { FuelLog, Vehicle } from '../types';
import styles from './FuelPage.module.css';

type ApiError = { response?: { data?: { message?: string } } };

interface FuelPrice {
  id: string;
  fuelType: string;
  pricePerLiter: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

interface ConsumptionStats {
  totalLiters: number;
  totalKilometers: number;
  totalCost: number;
  averageConsumption: number;
  anomalyCount: number;
  logCount: number;
}

const FUEL_TYPES = ['essence', 'gasoil', 'diesel', 'electric', 'hybrid'];

export default function FuelPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'manual' | 'gps' | 'prices'>('manual');
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [editing, setEditing] = useState<FuelLog | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FuelLog | null>(null);
  const [form, setForm] = useState({
    vehicleId: '', liters: '', kilometers: '', cost: '', fillDate: '', notes: '',
  });
  const [priceForm, setPriceForm] = useState({
    fuelType: 'diesel',
    pricePerLiter: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveUntil: '',
  });
  const [addingPrice, setAddingPrice] = useState(false);
  const [editingPrice, setEditingPrice] = useState<FuelPrice | null>(null);
  const [deletingPrice, setDeletingPrice] = useState<FuelPrice | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<Record<string, string>>({});
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ['fuel-consumption', page],
    queryFn: () => api.get(`/fuel-consumption?page=${page}&limit=${limit}`).then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ['fuel-consumption-stats'],
    queryFn: () => api.get('/fuel-consumption/stats').then((r) => r.data),
    staleTime: 15000,
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

  const { data: pricesData, isLoading: pricesLoading } = useQuery({
    queryKey: ['fuel-prices'],
    queryFn: () => api.get('/fuel-consumption/prices').then((r) => r.data),
    enabled: tab === 'prices',
  });

  const defaultsKey = JSON.stringify(pricesData?.defaults ?? null);

  useEffect(() => {
    if (!pricesData?.defaults) return;
    const draft: Record<string, string> = {};
    for (const ft of FUEL_TYPES) {
      draft[ft] = String(pricesData.defaults[ft] ?? '');
    }
    setDefaultsDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

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
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption-stats'] });
      toast(t('fuel.updateSuccess'));
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.updateError'), 'error');
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post('/fuel-consumption', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption-stats'] });
      toast(t('fuel.addSuccess'));
      setCreating(false);
      setPage(1);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.addError'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-consumption/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-consumption-stats'] });
      toast(t('fuel.deleteSuccess'));
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.deleteError'), 'error');
      setDeleting(null);
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: (payload: Record<string, number>) =>
      api.put('/fuel-consumption/prices/defaults', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-prices'] });
      toast(t('fuel.defaultsSaved'));
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.defaultsError'), 'error');
    },
  });

  const createPriceMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post('/fuel-consumption/prices', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-prices'] });
      toast(t('fuel.priceSaved'));
      setAddingPrice(false);
      setEditingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.priceError'), 'error');
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/fuel-consumption/prices/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-prices'] });
      toast(t('fuel.priceUpdated'));
      setAddingPrice(false);
      setEditingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.priceError'), 'error');
    },
  });

  const deletePriceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-consumption/prices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-prices'] });
      toast(t('fuel.priceDeleted'));
      setDeletingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fuel.priceDeleteError'), 'error');
      setDeletingPrice(null);
    },
  });

  const openEdit = (l: FuelLog) => {
    setEditing(l);
    setCreating(false);
    setForm({
      vehicleId: l.vehicleId ?? l.vehicle?.id ?? '',
      liters: String(l.liters),
      kilometers: String(l.kilometers),
      cost: String(l.cost),
      fillDate: l.fillDate.slice(0, 10),
      notes: l.notes ?? '',
    });
  };

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({
      vehicleId: (vehicles && vehicles.length > 0 ? vehicles[0].id : ''),
      liters: '',
      kilometers: '',
      cost: '',
      fillDate: new Date().toISOString().slice(0, 10),
      notes: '',
    });
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
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

  const saveCreate = () => {
    if (!form.vehicleId || !form.liters || !form.kilometers || !form.cost || !form.fillDate) {
      toast(t('fuel.requiredFields'), 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      liters: Number(form.liters),
      kilometers: Number(form.kilometers),
      cost: Number(form.cost),
      fillDate: new Date(form.fillDate).toISOString(),
      vehicleId: form.vehicleId,
    };
    if (form.notes.trim()) payload.notes = form.notes.trim();
    createMutation.mutate(payload);
  };

  const saveDefaults = () => {
    const payload: Record<string, number> = {};
    for (const ft of FUEL_TYPES) {
      const num = Number(defaultsDraft[ft]);
      if (Number.isFinite(num) && num >= 0) payload[ft] = num;
    }
    if (Object.keys(payload).length === 0) {
      toast(t('fuel.invalidPrice'), 'error');
      return;
    }
    saveDefaultsMutation.mutate(payload);
  };

  const openAddPrice = () => {
    setEditingPrice(null);
    setAddingPrice(true);
    setPriceForm({
      fuelType: 'diesel',
      pricePerLiter: '',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveUntil: '',
    });
  };

  const openEditPrice = (p: FuelPrice) => {
    setAddingPrice(false);
    setEditingPrice(p);
    setPriceForm({
      fuelType: p.fuelType,
      pricePerLiter: String(p.pricePerLiter),
      effectiveFrom: p.effectiveFrom.slice(0, 10),
      effectiveUntil: p.effectiveUntil ? p.effectiveUntil.slice(0, 10) : '',
    });
  };

  const closePriceDialog = () => {
    setAddingPrice(false);
    setEditingPrice(null);
  };

  const savePrice = () => {
    const price = Number(priceForm.pricePerLiter);
    if (!priceForm.fuelType || !Number.isFinite(price) || price < 0 || !priceForm.effectiveFrom) {
      toast(t('fuel.invalidPrice'), 'error');
      return;
    }
    const payload: Record<string, unknown> = {
      fuelType: priceForm.fuelType,
      pricePerLiter: price,
      effectiveFrom: priceForm.effectiveFrom,
    };
    if (priceForm.effectiveUntil) payload.effectiveUntil = priceForm.effectiveUntil;
    if (editingPrice) {
      updatePriceMutation.mutate({ id: editingPrice.id, payload });
    } else {
      createPriceMutation.mutate(payload);
    }
  };

  const entries: FuelLog[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit, totalPages: 1 };
  interface FuelReport {
    id: string | number;
    driverName?: string;
    vehiclePlate?: string;
    distanceKm?: number;
    gpsDataQuality?: 'sufficient' | 'insufficient';
    consumptionLPer100Km?: number;
    estimatedCost?: number;
    reportDate?: string;
  }
  const reportList: FuelReport[] = reports ?? [];
  const priceHistory: FuelPrice[] = pricesData?.history ?? [];
  const s: Partial<ConsumptionStats> = stats ?? {};

  const tabButtons = [
    { key: 'manual' as const, label: t('fuel.tabManual'), icon: <PenLine size={15} /> },
    { key: 'gps' as const, label: t('fuel.tabGps'), icon: <Radar size={15} /> },
    { key: 'prices' as const, label: t('fuel.tabPrices'), icon: <CircleDollarSign size={15} /> },
  ];

  const statCards = [
    {
      label: t('fuel.stats.totalLiters'),
      value: s.totalLiters ?? 0,
      unit: t('fuel.unitLiters'),
      icon: <Droplets size={18} />,
      variant: 'teal' as const,
      mono: true,
    },
    {
      label: t('fuel.stats.totalKm'),
      value: s.totalKilometers ?? 0,
      unit: t('fuel.unitKm'),
      icon: <Gauge size={18} />,
      variant: 'accent' as const,
      mono: true,
    },
    {
      label: t('fuel.stats.totalCost'),
      value: formatAriary(s.totalCost ?? 0),
      unit: '',
      icon: <Wallet size={18} />,
      variant: 'blue' as const,
      mono: false,
    },
    {
      label: t('fuel.stats.avgConsumption'),
      value: (s.averageConsumption ?? 0).toFixed(1),
      unit: t('fuel.unitPer100'),
      icon: <Fuel size={18} />,
      variant: 'accent' as const,
      mono: true,
    },
    {
      label: t('fuel.stats.anomalies'),
      value: s.anomalyCount ?? 0,
      unit: '',
      icon: <AlertTriangle size={18} />,
      variant: 'red' as const,
      mono: true,
    },
  ];

  if (isLoading || reportsLoading || pricesLoading) {
    return (
      <div className={styles.pageContainer}>
        <div className={`${styles.skeleton} ${styles.skeletonHeader}`} />
        <div className={`${styles.skeleton} ${styles.skeletonTabs}`} />
        <div className={styles.skeletonStats}>
          <div className={`${styles.skeleton} ${styles.skeletonStat}`} />
          <div className={`${styles.skeleton} ${styles.skeletonStat}`} />
          <div className={`${styles.skeleton} ${styles.skeletonStat}`} />
          <div className={`${styles.skeleton} ${styles.skeletonStat}`} />
        </div>
        <div className={`${styles.skeleton} ${styles.skeletonTable}`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.pageTitle}>{t('fuel.title')}</h1>
          </div>
        </div>
        <p className={styles.errorText}>{t('fuel.error')}</p>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerTitleWrap}>
          <h1 className={styles.pageTitle}>{t('fuel.title')}</h1>
          <p className={styles.pageSubtitle}>{t('fuel.subtitle')}</p>
        </div>
        <span className={styles.headerBadge}>
          <Fuel size={13} />
          {s.logCount ?? 0} {t('fuel.stats.logs')}
        </span>
      </div>

      <div className={styles.tabsRow}>
        {tabButtons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`${styles.tabBtn} ${tab === b.key ? styles.tabBtnActive : styles.tabBtnInactive}`}
            onClick={() => setTab(b.key)}
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>

      {/* Saisie manuelle */}
      {tab === 'manual' && (
        <>
          <div className={styles.toolbarRow}>
            <div className={styles.statsGrid}>
              {statCards.map((c) => (
                <div key={c.label} className={styles.statCard}>
                  <div className={`${styles.statIcon} ${
                    c.variant === 'teal' ? styles.statIconTeal
                      : c.variant === 'red' ? styles.statIconRed
                        : c.variant === 'blue' ? styles.statIconBlue
                          : ''
                  }`}>
                    {c.icon}
                  </div>
                  <div className={styles.statBody}>
                    <span className={styles.statLabel}>{c.label}</span>
                    <span className={styles.statValue}>
                      {c.value}
                      {c.unit && <span className={styles.statUnit}>{c.unit}</span>}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              className={styles.addBtn}
              onClick={openCreate}
            >
              <Plus size={16} /> {t('fuel.addEntry')}
            </button>
          </div>

          {entries.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><Inbox size={24} /></span>
              <p className={styles.emptyTitle}>{t('fuel.title')}</p>
              <p className={styles.emptyText}>{t('fuel.empty')}</p>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <div className={styles.tableCard}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.tableHeadRow}>
                        <th className={styles.tableHeadCell}>{t('fuel.table.vehicle')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.table.liters')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.table.kmHeader')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.table.consumption')}</th>
                        <th className={styles.tableHeadCellRight}>{t('fuel.table.cost')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.table.date')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.table.anomaly')}</th>
                        <th className={styles.tableHeadCellRight}>{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((l) => (
                        <tr key={l.id} className={styles.tableRow}>
                          <td className={styles.tableCellBold}>{l.vehicle?.licensePlate ?? '-'}</td>
                          <td className={styles.tableCellMono}>{l.liters}</td>
                          <td className={styles.tableCellMono}>{l.kilometers}</td>
                          <td className={styles.tableCellMono}>{l.calculatedConsumption?.toFixed(1) ?? '-'}</td>
                          <td className={`${styles.tableCellMono} ${styles.tableCellRight}`}>{l.cost.toFixed(2)} €</td>
                          <td className={styles.tableCell}>{new Date(l.fillDate).toLocaleDateString(i18n.language)}</td>
                          <td className={styles.tableCell}>
                            {l.anomalyFlag ? (
                              <span
                                className={`${styles.badge} ${styles.badgeAnomaly}`}
                                title={l.consumptionDeviationDirection
                                  ? l.consumptionDeviationDirection === 'over'
                                    ? t('fuel.overConsumption')
                                    : t('fuel.underConsumption')
                                  : undefined}
                              >
                                <AlertTriangle size={12} /> {t('fuel.anomaly')}
                              </span>
                            ) : l.gpsCoverageInsufficientFlag ? (
                              // Signal « non vérifiable » : couverture GPS absente sur la
                              // période (gpsCoverageInsufficientFlag), affiché en neutre
                              // (gris), distinct du rouge des anomalies confirmées.
                              <span
                                className={`${styles.badge} ${styles.badgeMuted}`}
                                title={l.gpsCoverageInsufficientReason ?? undefined}
                              >
                                <HelpCircle size={12} /> {t('fuel.nonVerifiable')}
                              </span>
                            ) : (
                              <span className={`${styles.badge} ${styles.badgeNormal}`}>
                                <CheckCircle2 size={12} /> {t('fuel.normal')}
                              </span>
                            )}
                          </td>
                          <td className={`${styles.tableCell} ${styles.tableCellRight}`}>
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
                </div>
              </div>

              {meta.totalPages > 1 && (
                <div className={styles.pagination}>
                  <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
                  {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  ))}
                  <button type="button" className={styles.pageBtn} disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>→</button>
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

          <div className={styles.controlCard}>
            <div className={styles.controlField}>
              <label className={styles.label}>{t('fuel.date')}</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className={styles.dateInput}
              />
            </div>
            <button
              type="button"
              className={styles.genBtn}
              onClick={() => generateMutation.mutate(reportDate)}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <RefreshCw size={15} style={{ animation: 'dt-spin 0.6s linear infinite' }} />
              ) : (
                <CalendarDays size={15} />
              )}
              {generateMutation.isPending ? t('fuel.generating') : t('fuel.generateReport')}
            </button>
          </div>

          {generateMutation.isSuccess && (
            <p className={styles.successText}>
              <CheckCircle2 size={14} /> {t('fuel.generateSuccess')}
            </p>
          )}

          {generateMutation.isError && (
            <p className={styles.errorTextMsg}>
              {t('fuel.generateError')}
            </p>
          )}

          {reportList.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><Radar size={24} /></span>
              <p className={styles.emptyTitle}>{t('fuel.tabGps')}</p>
              <p className={styles.emptyText}>{t('fuel.gpsEmpty')}</p>
            </div>
          )}

          {reportList.length > 0 && (
            <div className={styles.tableCard}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr className={styles.tableHeadRow}>
                      <th className={styles.tableHeadCell}>{t('fuel.table.driver')}</th>
                      <th className={styles.tableHeadCell}>{t('fuel.table.vehicle')}</th>
                      <th className={styles.tableHeadCell}>{t('fuel.gpsDistance')}</th>
                      <th className={styles.tableHeadCell}>{t('fuel.table.consumption')}</th>
                      <th className={styles.tableHeadCellRight}>{t('fuel.estimatedCost')}</th>
                      <th className={styles.tableHeadCell}>{t('fuel.table.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportList.map((r: FuelReport, i: number) => (
                      <tr key={r.id || i} className={styles.tableRow}>
                        <td className={styles.tableCell}>
                          <span className={`${styles.badge} ${styles.badgeDriver}`}>{r.driverName}</span>
                        </td>
                        <td className={styles.tableCellBold}>{r.vehiclePlate}</td>
                        <td className={styles.tableCellMono}>{r.distanceKm?.toFixed(1)} km</td>
                        <td className={styles.tableCellMono}>{r.consumptionLPer100Km?.toFixed(1) ?? '-'} L/100km</td>
                        <td className={`${styles.tableCellMono} ${styles.tableCellRight}`}>{formatAriary(r.estimatedCost)}</td>
                        <td className={styles.tableCell}>{r.reportDate ? new Date(r.reportDate).toLocaleDateString(i18n.language) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={styles.helpBox}>
            <span className={styles.helpIcon}><Info size={16} /></span>
            <span className={styles.helpBody}>
              <strong>{t('fuel.helpTitle')} :</strong><br />
              {t('fuel.helpManual')}<br />
              {t('fuel.helpGps')}
            </span>
          </div>
        </div>
      )}

      {/* Prix carburant */}
      {tab === 'prices' && (
        <div>
          <p className={styles.helpText}>
            {t('fuel.pricesHelp')}
          </p>

          <div className={styles.pricesSection}>
            <h3 className={styles.pricesTitle}>{t('fuel.defaultPricesTitle')}</h3>
            <p className={styles.helpText}>{t('fuel.defaultPricesHelp')}</p>
            <div className={styles.defaultsGrid}>
              {FUEL_TYPES.map((ft) => (
                <div key={ft} className={styles.defaultsField}>
                  <label className={styles.defaultsFieldLabel}>{t(`fuel.types.${ft}`)}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    className={styles.dateInput}
                    value={defaultsDraft[ft] ?? ''}
                    onChange={(e) => setDefaultsDraft((d) => ({ ...d, [ft]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={saveDefaults}
                disabled={saveDefaultsMutation.isPending}
              >
                {saveDefaultsMutation.isPending ? '…' : t('fuel.saveDefaults')}
              </button>
            </div>
          </div>

          <div className={styles.pricesSection}>
            <div className={styles.historyHeader}>
              <h3 className={styles.pricesTitle}>{t('fuel.historyTitle')}</h3>
              <button type="button" className={styles.addBtn} onClick={openAddPrice}>
                <Plus size={16} /> {t('fuel.addPrice')}
              </button>
            </div>
            <p className={styles.helpText}>{t('fuel.historyHelp')}</p>

            {priceHistory.length === 0 && (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}><CircleDollarSign size={24} /></span>
                <p className={styles.emptyTitle}>{t('fuel.historyTitle')}</p>
                <p className={styles.emptyText}>{t('fuel.noPrices')}</p>
              </div>
            )}

            {priceHistory.length > 0 && (
              <div className={styles.tableCard}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.tableHeadRow}>
                        <th className={styles.tableHeadCell}>{t('fuel.fuelType')}</th>
                        <th className={styles.tableHeadCellRight}>{t('fuel.pricePerLiter')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.effectiveFrom')}</th>
                        <th className={styles.tableHeadCell}>{t('fuel.effectiveUntil')}</th>
                        <th className={styles.tableHeadCellRight}>{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistory.map((p) => (
                        <tr key={p.id} className={styles.tableRow}>
                          <td className={styles.tableCellBold}>{t(`fuel.types.${p.fuelType}`, { defaultValue: p.fuelType })}</td>
                          <td className={`${styles.tableCellMono} ${styles.tableCellRight}`}>{formatAriary(p.pricePerLiter)}</td>
                          <td className={styles.tableCell}>{new Date(p.effectiveFrom).toLocaleDateString(i18n.language)}</td>
                          <td className={styles.tableCell}>{p.effectiveUntil ? new Date(p.effectiveUntil).toLocaleDateString(i18n.language) : '—'}</td>
                          <td className={`${styles.tableCell} ${styles.tableCellRight}`}>
                            <div className={styles.actionsRow}>
                              <button
                                type="button"
                                className={styles.actionBtn}
                                onClick={() => openEditPrice(p)}
                                title={t('common.edit')}
                                aria-label={t('common.edit')}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                className={`${styles.actionBtn} ${styles.danger}`}
                                onClick={() => setDeletingPrice(p)}
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
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <EntityDialog
        open={!!editing || creating}
        onClose={closeDialog}
        title={editing ? t('fuel.editTitle') : t('fuel.addTitle')}
        footer={
          <DialogSubmitBar
            loading={updateMutation.isPending || createMutation.isPending}
            onCancel={closeDialog}
            submitLabel={editing ? t('common.save') : t('fuel.addSubmit')}
            form={editing ? 'fuel-edit-form' : 'fuel-create-form'}
          />
        }
      >
        <form
          id={editing ? 'fuel-edit-form' : 'fuel-create-form'}
          onSubmit={(e) => { e.preventDefault(); editing ? saveEdit() : saveCreate(); }}
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
            <DialogField label={t('fuel.table.km')} hint={t('fuel.kmHelper')} required>
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

      <EntityDialog
        open={addingPrice || !!editingPrice}
        onClose={closePriceDialog}
        title={editingPrice ? t('fuel.editPriceTitle') : t('fuel.addPriceTitle')}
        footer={
          <DialogSubmitBar
            loading={createPriceMutation.isPending || updatePriceMutation.isPending}
            onCancel={closePriceDialog}
            submitLabel={editingPrice ? t('common.save') : t('fuel.addPrice')}
            form="fuel-price-form"
          />
        }
      >
        <form
          id="fuel-price-form"
          onSubmit={(e) => { e.preventDefault(); savePrice(); }}
        >
          <DialogSection title={editingPrice ? t('fuel.editPriceTitle') : t('fuel.addPriceTitle')}>
            <DialogField label={t('fuel.fuelType')} required>
              <select
                className="dialog-select"
                value={priceForm.fuelType}
                onChange={(e) => setPriceForm({ ...priceForm, fuelType: e.target.value })}
              >
                {FUEL_TYPES.map((ft) => (
                  <option key={ft} value={ft}>{t(`fuel.types.${ft}`)}</option>
                ))}
              </select>
            </DialogField>
            <DialogField label={t('fuel.pricePerLiter')} required>
              <input
                className="dialog-input"
                type="number"
                min="0"
                step="any"
                value={priceForm.pricePerLiter}
                onChange={(e) => setPriceForm({ ...priceForm, pricePerLiter: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.effectiveFrom')} required>
              <input
                className="dialog-input"
                type="date"
                value={priceForm.effectiveFrom}
                onChange={(e) => setPriceForm({ ...priceForm, effectiveFrom: e.target.value })}
              />
            </DialogField>
            <DialogField label={t('fuel.effectiveUntil')}>
              <input
                className="dialog-input"
                type="date"
                value={priceForm.effectiveUntil}
                onChange={(e) => setPriceForm({ ...priceForm, effectiveUntil: e.target.value })}
              />
            </DialogField>
          </DialogSection>
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deletingPrice}
        title={t('fuel.confirmDeletePriceTitle')}
        message={
          deletingPrice
            ? `${t('fuel.fuelType')} : ${t(`fuel.types.${deletingPrice.fuelType}`, { defaultValue: deletingPrice.fuelType })} — ${formatAriary(deletingPrice.pricePerLiter)}`
            : ''
        }
        variant="danger"
        confirmLabel={t('common.delete')}
        onConfirm={() => deletingPrice && deletePriceMutation.mutate(deletingPrice.id)}
        onCancel={() => setDeletingPrice(null)}
      />

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
