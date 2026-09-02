import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, ChevronDown, ChevronUp, Upload, Package, PackageOpen, MapPin,
  Calendar, CalendarDays, AlertTriangle, Clock, CheckCircle2, Loader2, Truck, StickyNote,
} from 'lucide-react';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Card from '../components/Card';
import { DELIVERY_STATUS_VARIANT } from '../services/deliveryStatus';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import styles from './DeliveriesPage.module.css';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef } from '../hooks/useEntityForm';
import LocationSearchInput from '../components/LocationSearchInput';
import { reverseGeocode } from '../services/geocoding/geocodingService';
import { formatAriary } from '../services/formatAriary';
import { useToast } from '../components/Toast';
import type { Delivery, Driver } from '../types';
import { useCountUp } from '../hooks/useCountUp';

type ApiError = { response?: { data?: { message?: string } }; userMessage?: string };

interface DeliveryFormValues {
  title: string;
  description: string;
  status: string;
  pickupAddress: string; deliveryAddress: string;
  pickupLat: string; pickupLng: string; pickupLocationLabel: string;
  deliveryLat: string; deliveryLng: string; deliveryLocationLabel: string;
  driverId: string;
  vehicleId: string;
  scheduledDate: string;
  notes: string;
}

const deliveryFields: FieldDef<DeliveryFormValues>[] = [
  { name: 'title', label: 'Titre de la livraison', type: 'text', required: true, section: 'main', autoFocus: true,
    rules: { minLength: 2, maxLength: 200 } },
  { name: 'status', label: 'Statut', type: 'text', section: 'main' },
  { name: 'pickupAddress', label: "Adresse d'enlèvement", type: 'text', required: true, section: 'addresses',
    rules: { minLength: 3 } },
  { name: 'deliveryAddress', label: 'Adresse de livraison', type: 'text', required: true, section: 'addresses',
    rules: { minLength: 3 } },
  { name: 'pickupLat', label: 'Latitude (enlèvement)', type: 'text', section: 'gps' },
  { name: 'pickupLng', label: 'Longitude (enlèvement)', type: 'text', section: 'gps' },
  { name: 'deliveryLat', label: 'Latitude (livraison)', type: 'text', section: 'gps' },
  { name: 'deliveryLng', label: 'Longitude (livraison)', type: 'text', section: 'gps' },
];

const STATUS_LABELS_KEY: Record<string, string> = {
  pending: 'pending', assigned: 'assigned', in_progress: 'in_progress',
  delivered: 'delivered', failed: 'failed', cancelled: 'cancelled',
};


function KpiCard({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: number; color: string; }) {
  const animated = useCountUp(value);
  return (
    <div className={styles.kpiCard} style={{ ['--kpi' as string]: color }}>
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}>{icon}</span>
      </div>
      <div className={styles.kpiValue}>{animated}</div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[38, 26, 32, 24, 22, 20, 24, 18].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%`, animationDelay: `${(i + j) * 90}ms` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function TitleCell({ delivery }: { delivery: Delivery }) {
  return (
    <span className={styles.titleCell}>
      <span className={styles.titleIcon}>
        <Package size={14} />
      </span>
      <span className={styles.titleCellText}>
        <span className={styles.titleCellMain}>{delivery.title}</span>
        {delivery.externalOrderRef && (
          <span className={styles.titleCellRef}>{delivery.externalOrderRef}</span>
        )}
      </span>
    </span>
  );
}

function DriverCell({ driver, unassignedLabel }: { driver: Delivery['driver']; unassignedLabel: string }) {
  if (!driver) return <span className={styles.unassignedPill}>{unassignedLabel}</span>;
  const initials = `${(driver.firstName[0] || '').toUpperCase()}${(driver.lastName[0] || '').toUpperCase()}`;
  return (
    <span className={styles.driverCell}>
      <span className={styles.driverAvatar}>{initials}</span>
      <span className={styles.driverName}>{driver.firstName} {driver.lastName}</span>
    </span>
  );
}

function DateCell({ delivery }: { delivery: Delivery }) {
  return (
    <span className={styles.dateCell}>
      <span className={styles.dateMain}>
        <Calendar size={12} />
        {formatDate(delivery.createdAt)}
      </span>
      {delivery.scheduledDate && (
        <span className={styles.dateScheduled}>
          <CalendarDays size={12} />
          {formatDate(delivery.scheduledDate)}
        </span>
      )}
    </span>
  );
}

function AmountCell({ amount }: { amount?: number }) {
  if (amount === undefined || amount === null) return <span className={styles.mutedText}>—</span>;
  return <span className={styles.amountText}>{formatAriary(amount)}</span>;
}

function DescriptionCell({ delivery }: { delivery: Delivery }) {
  const desc = delivery.productDescription || delivery.description;
  if (desc) return <span className={styles.descriptionText}>{desc}</span>;
  if (delivery.notes) return <span className={styles.notesText}><StickyNote size={13} /> {delivery.notes.slice(0, 60)}</span>;
  return <span className={styles.mutedText}>—</span>;
}

export default function DeliveriesPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [deleting, setDeleting] = useState<Delivery | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState<'create-only' | 'upsert'>('create-only');
  const [importReport, setImportReport] = useState<{
    created: number; updated: number;
    skipped: { row: number; orderRef: string; reason: string }[];
    errors: { row: number; reason: string }[];
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', page],
    queryFn: () => api.get(`/deliveries?page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: driversData } = useQuery({
    queryKey: ['drivers', 'active'],
    queryFn: () => api.get('/drivers?page=1&limit=100').then((r) => r.data),
    enabled: drawerOpen,
    staleTime: 30000,
  });

  const deliveries: Delivery[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };
  const drivers: Driver[] = driversData?.data ?? [];

  const stats = {
    total: deliveries.length,
    pending: deliveries.filter((d) => d.status === 'pending').length,
    inProgress: deliveries.filter((d) => d.status === 'in_progress' || d.status === 'assigned').length,
    delivered: deliveries.filter((d) => d.status === 'delivered').length,
  };

  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    return deliveries.flatMap((d) => {
      const places: { label: string; lat: number; lng: number }[] = [];
      if (d.pickupAddress && d.pickupLat && d.pickupLng && !seen.has(d.pickupAddress)) {
        seen.add(d.pickupAddress);
        places.push({ label: d.pickupAddress, lat: d.pickupLat, lng: d.pickupLng });
      }
      if (d.deliveryAddress && d.deliveryLat && d.deliveryLng && !seen.has(d.deliveryAddress)) {
        seen.add(d.deliveryAddress);
        places.push({ label: d.deliveryAddress, lat: d.deliveryLat, lng: d.deliveryLng });
      }
      return places;
    }).slice(0, 5);
  }, [deliveries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return deliveries;
    const q = search.toLowerCase();
    return deliveries.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      d.pickupAddress.toLowerCase().includes(q) ||
      d.deliveryAddress.toLowerCase().includes(q) ||
      d.status.toLowerCase().includes(q)
    );
  }, [deliveries, search]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

  const importMutation = useMutation({
    mutationFn: ({ file, mode }: { file: File; mode: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`/deliveries/import?mode=${mode}`, formData, {
        timeout: 60000,
      }).then((r) => r.data);
    },
    onSuccess: (report: { created: number; updated: number; skipped: { row: number; orderRef: string; reason: string }[]; errors: { row: number; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setImporting(false);
      setImportReport(report);
      const parts: string[] = [];
      const createdLabel = report.created > 1 ? t('deliveries.import.report.created_plural') : t('deliveries.import.report.created');
      const updatedLabel = report.updated > 1 ? t('deliveries.import.report.updated_plural') : t('deliveries.import.report.updated');
      const skippedLabel = report.skipped.length > 1 ? t('deliveries.import.report.skipped_plural') : t('deliveries.import.report.skipped');
      const errorsLabel = report.errors.length > 1 ? t('deliveries.import.report.errors_plural') : t('deliveries.import.report.errors');
      if (report.created > 0) parts.push(t('deliveries.import.report.line', { count: report.created, label: createdLabel }));
      if (report.updated > 0) parts.push(t('deliveries.import.report.line', { count: report.updated, label: updatedLabel }));
      if (report.skipped.length > 0) parts.push(t('deliveries.import.report.line', { count: report.skipped.length, label: skippedLabel }));
      if (report.errors.length > 0) parts.push(t('deliveries.import.report.line', { count: report.errors.length, label: errorsLabel }));
      if (parts.length > 0) toast(`${parts.join(' - ')} — ${t('deliveries.import.report.seeDetail')}`);
      else toast(t('deliveries.import.report.none'));
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: ApiError) => {
      setImporting(false);
      toast(err?.response?.data?.message || t('deliveries.toast.importError'), 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.xlsx$/i)) {
      toast(t('deliveries.toast.invalidFile'), 'error');
      return;
    }
    setImporting(true);
    importMutation.mutate({ file, mode: importMode });
  }, [importMutation, toast, importMode]);

  const bulkMutation = useMutation({
    mutationFn: (payload: { ids: string[]; action: string; status?: string; driverId?: string }) =>
      api.post('/deliveries/bulk-action', payload).then((r) => r.data),
    onSuccess: (report: { succeeded: string[]; failed: { id: string; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setBulkActionLoading(false);
      if (report.failed.length > 0) {
        toast(t('deliveries.bulk.partialResult', {
          succeeded: report.succeeded.length,
          failed: report.failed.length,
          reason: report.failed[0].reason,
        }), 'error');
      } else {
        toast(t('deliveries.bulk.successResult', { count: report.succeeded.length }));
      }
      setSelectedIds(new Set());
    },
    onError: (err: ApiError) => {
      setBulkActionLoading(false);
      toast(err?.response?.data?.message || t('deliveries.bulk.error'), 'error');
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: DeliveryFormValues) => {
      const payload: Record<string, unknown> = {
        title: body.title,
        status: body.status || 'pending',
        pickupAddress: body.pickupAddress,
        deliveryAddress: body.deliveryAddress,
      };
      if (body.description) payload.description = body.description;
      if (body.pickupLat) payload.pickupLat = parseFloat(body.pickupLat);
      if (body.pickupLng) payload.pickupLng = parseFloat(body.pickupLng);
      if (body.pickupLocationLabel) payload.pickupLocationLabel = body.pickupLocationLabel;
      if (body.deliveryLat) payload.deliveryLat = parseFloat(body.deliveryLat);
      if (body.deliveryLng) payload.deliveryLng = parseFloat(body.deliveryLng);
      if (body.deliveryLocationLabel) payload.deliveryLocationLabel = body.deliveryLocationLabel;
      if (body.driverId) payload.driverId = body.driverId;
      if (body.vehicleId) payload.vehicleId = body.vehicleId;
      if (body.scheduledDate) payload.scheduledDate = body.scheduledDate;
      if (body.notes) payload.notes = body.notes;
      return editing
        ? api.patch(`/deliveries/${editing.id}`, payload)
        : api.post('/deliveries', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      const id = editing?.id || '';
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1500);
      toast(editing ? t('deliveries.toast.updated') : t('deliveries.toast.created'));
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.userMessage || err?.response?.data?.message || t('deliveries.toast.saveError'), 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast(t('deliveries.toast.deleted'));
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('deliveries.toast.deleteError'), 'error');
      setDeleting(null);
    },
  });

  const resolveMismatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/deliveries/${id}/resolve-mismatch`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast(t('deliveries.toast.mismatchResolved'));
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const emptyForm: DeliveryFormValues = {
    title: '', description: '', status: 'pending', pickupAddress: '', deliveryAddress: '',
    pickupLat: '', pickupLng: '', pickupLocationLabel: '',
    deliveryLat: '', deliveryLng: '', deliveryLocationLabel: '',
    driverId: '', vehicleId: '', scheduledDate: '', notes: '',
  };

  const deliveryForm = useEntityForm<DeliveryFormValues>({
    initial: editing ? {
      title: editing.title,
      description: editing.description || '',
      status: editing.status,
      pickupAddress: editing.pickupAddress,
      deliveryAddress: editing.deliveryAddress,
      pickupLat: editing.pickupLat?.toString() || '',
      pickupLng: editing.pickupLng?.toString() || '',
      pickupLocationLabel: editing.pickupLocationLabel || '',
      deliveryLat: editing.deliveryLat?.toString() || '',
      deliveryLng: editing.deliveryLng?.toString() || '',
      deliveryLocationLabel: editing.deliveryLocationLabel || '',
      driverId: editing.driverId || '',
      vehicleId: editing.vehicleId || '',
      scheduledDate: editing.scheduledDate?.split('T')[0] || '',
      notes: editing.notes || '',
    } : emptyForm,
    fields: deliveryFields,
    sections: [],
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  useEffect(() => {
    if (drawerOpen) { deliveryForm.reset(); setShowAdvanced(false); }
  }, [drawerOpen, editing?.id]);

  const [reverseLoading, setReverseLoading] = useState(false);

  useEffect(() => {
    if (!editing || !drawerOpen) return;
    const doReverse = async () => {
      setReverseLoading(true);
      const updates: Record<string, string> = {};
      if (editing.pickupLat && editing.pickupLng && !editing.pickupLocationLabel) {
        const label = await reverseGeocode(editing.pickupLat, editing.pickupLng);
        if (label) updates.pickupLocationLabel = label;
      }
      if (editing.deliveryLat && editing.deliveryLng && !editing.deliveryLocationLabel) {
        const label = await reverseGeocode(editing.deliveryLat, editing.deliveryLng);
        if (label) updates.deliveryLocationLabel = label;
      }
      for (const [k, v] of Object.entries(updates)) {
        deliveryForm.setValue(k as keyof DeliveryFormValues, v);
      }
      setReverseLoading(false);
    };
    doReverse();
  }, [editing?.id, drawerOpen]);

  const drawerTitle = editing ? editing.title : t('deliveries.newDelivery');
  const drawerSubtitle = editing
    ? (t(`deliveries.status.${editing.status}`))
    : t('deliveries.drawerNew');
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  const setLocationField = useCallback((field: 'pickup' | 'delivery', value: { lat: number | null; lng: number | null; label: string }) => {
    const prefix = field;
    deliveryForm.setValue(`${prefix}Lat` as keyof DeliveryFormValues, value.lat !== null ? value.lat.toString() : '');
    deliveryForm.setValue(`${prefix}Lng` as keyof DeliveryFormValues, value.lng !== null ? value.lng.toString() : '');
    deliveryForm.setValue(`${prefix}LocationLabel` as keyof DeliveryFormValues, value.label);
    if (field === 'pickup') {
      deliveryForm.setValue('pickupAddress' as keyof DeliveryFormValues, value.label || '');
    } else {
      deliveryForm.setValue('deliveryAddress' as keyof DeliveryFormValues, value.label || '');
    }
  }, [deliveryForm.setValue]);

  const copyPickupToDelivery = useCallback(() => {
    const pickupLabel = deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress;
    const pickupLat = deliveryForm.values.pickupLat;
    const pickupLng = deliveryForm.values.pickupLng;
    if (pickupLabel) {
      deliveryForm.setValue('deliveryAddress' as keyof DeliveryFormValues, pickupLabel);
      deliveryForm.setValue('deliveryLocationLabel' as keyof DeliveryFormValues, pickupLabel);
      if (pickupLat) deliveryForm.setValue('deliveryLat' as keyof DeliveryFormValues, pickupLat);
      if (pickupLng) deliveryForm.setValue('deliveryLng' as keyof DeliveryFormValues, pickupLng);
    }
  }, [deliveryForm.values, deliveryForm.setValue]);

  const getDriverLabel = (d: Driver) =>
    `${d.firstName} ${d.lastName}${d.phone ? ` — ${d.phone}` : ''}`;

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><Package size={24} /></div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('deliveries.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('deliveries.title')}</h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0
              ? t(meta.total > 1 ? 'deliveries.count_plural' : 'deliveries.count', { count: meta.total })
              : t('deliveries.subtitle')}
          </p>
        </div>
        <div className={styles.actionButtonsRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className={styles.hiddenFileInput}
            onChange={handleFileChange}
          />
          <div className={styles.importGroup}>
            <Button variant="secondary" size="sm" icon={<Upload size={16} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? t('deliveries.import.importing') : t('deliveries.import.action')}
            </Button>
            <button
              onClick={() => setImportMode(importMode === 'create-only' ? 'upsert' : 'create-only')}
              title={importMode === 'create-only' ? t('deliveries.import.tooltip.skipDuplicates') : t('deliveries.import.tooltip.updateExisting')}
              className={styles.importModeToggle}
              style={{ background: importMode === 'upsert' ? 'var(--color-accent-muted)' : 'transparent' }}
            >
              {importMode === 'create-only' ? t('deliveries.import.mode.skip') : t('deliveries.import.mode.update')}
            </button>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
            {t('deliveries.newDelivery')}
          </Button>
        </div>
      </header>

      <div className={styles.kpiGrid}>
        <KpiCard icon={<Package size={18} />} label={t('deliveries.kpis.total')} value={stats.total} color="var(--color-accent, #F2A93C)" />
        <KpiCard icon={<Clock size={18} />} label={t('deliveries.kpis.pending')} value={stats.pending} color="var(--color-warning, #f59e0b)" />
        <KpiCard icon={<Truck size={18} />} label={t('deliveries.kpis.inProgress')} value={stats.inProgress} color="var(--color-blue, #3b82f6)" />
        <KpiCard icon={<CheckCircle2 size={18} />} label={t('deliveries.kpis.delivered')} value={stats.delivered} color="var(--color-teal, #3FA796)" />
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder={t('deliveries.searchPlaceholder')}
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {search && (
          <span className={styles.resultCount}>
            {t(search.length > 1 ? 'deliveries.resultCount_plural' : 'deliveries.resultCount', { count: filtered.length })}
          </span>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.bulkActionBar}>
          <span className={styles.bulkActionCount}>
            {t(selectedIds.size > 1 ? 'deliveries.bulk.selected_plural' : 'deliveries.bulk.selected', { count: selectedIds.size })}
          </span>
          <select
            className={styles.bulkActionSelect}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              setBulkActionLoading(true);
              bulkMutation.mutate({ ids: [...selectedIds], action: 'updateStatus', status: val });
              e.target.value = '';
            }}
            disabled={bulkActionLoading}
          >
            <option value="">{t('deliveries.bulk.changeStatus')}</option>
            {Object.entries(STATUS_LABELS_KEY).map(([k]) => (
              <option key={k} value={k}>{t(`deliveries.status.${k}`)}</option>
            ))}
          </select>
          <select
            className={styles.bulkActionSelect}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              setBulkActionLoading(true);
              bulkMutation.mutate({ ids: [...selectedIds], action: 'assignDriver', driverId: val });
              e.target.value = '';
            }}
            disabled={bulkActionLoading}
          >
            <option value="">{t('deliveries.bulk.assignDriver')}</option>
            {drivers.filter((d) => d.isActive).map((d) => (
              <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
            ))}
          </select>
          <button
            onClick={() => {
              setBulkActionLoading(true);
              bulkMutation.mutate({ ids: [...selectedIds], action: 'delete' });
            }}
            disabled={bulkActionLoading}
            className={styles.bulkDeleteBtn}
          >
            {t('deliveries.bulk.delete')}
          </button>
          {bulkActionLoading && <span className={styles.bulkLoadingText}>{t('deliveries.bulk.loading')}</span>}
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkActionLoading}
            className={styles.clearSelectionBtn}
          >
            {t('deliveries.bulk.clearSelection')}
          </button>
        </div>
      )}

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {[
                    t('deliveries.table.title'),
                    t('deliveries.table.status'),
                    t('deliveries.table.deliveryAddress'),
                    t('deliveries.table.driver'),
                    t('deliveries.table.date'),
                    t('deliveries.table.clientPhone'),
                    t('deliveries.table.amount'),
                    t('deliveries.table.description'),
                    '',
                  ].map((l, idx) => (
                    <th key={idx} className={styles.skeletonTh} style={{ textAlign: l === '' ? 'right' : 'left' }}>
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <SkeletonRows />
              </tbody>
            </table>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIconWrap}>
              <PackageOpen size={26} />
            </div>
            <p className={styles.emptyTitle}>
              {search ? t('deliveries.empty.noMatch') : t('deliveries.empty.noData')}
            </p>
            <p className={styles.emptyDesc}>
              {search ? t('deliveries.empty.tryDifferent') : t('deliveries.empty.createFirst')}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                {t('deliveries.newDelivery')}
              </Button>
            )}
          </div>
        ) : (
          <Card flush animated >
            <DataTable
              selectable
              selectedIds={selectedIds}
              onSelectionChange={(ids) => {
                setSelectedIds(ids);
              }}
              columns={[
                {
                  key: 'title', label: t('deliveries.table.title'), sortable: true,
                  render: (r: Delivery) => <TitleCell delivery={r} />,
                },
                {
                  key: 'status', label: t('deliveries.table.status'), sortable: true,
                  render: (r: Delivery) => (
                    <div className={styles.statusColumn}>
                      <Badge variant={DELIVERY_STATUS_VARIANT[r.status] || 'neutral'} size="sm" dot>
                        {t(`deliveries.status.${r.status}`)}
                      </Badge>
                      {r.locationMismatch && !r.mismatchResolved && (
                        <div className={styles.mismatchAlert}>
                          <AlertTriangle size={12} />
                          <span>{r.deliveryProofDistance != null ? t('deliveries.mismatch.distance', { distance: r.deliveryProofDistance }) : t('deliveries.mismatch.detected')}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); resolveMismatchMutation.mutate(r.id); }}
                            disabled={resolveMismatchMutation.isPending}
                            className={styles.mismatchResolveBtn}
                          >
                            <CheckCircle2 size={12} /> {t('deliveries.mismatch.resolved')}
                          </button>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'deliveryAddress', label: t('deliveries.table.deliveryAddress'),
                  render: (r: Delivery) => (
                    <span className={styles.addressCell}>
                      <MapPin size={13} />
                      <span>{r.deliveryAddress}</span>
                    </span>
                  ),
                },
                {
                  key: 'driver', label: t('deliveries.table.driver'),
                  render: (r: Delivery) => <DriverCell driver={r.driver} unassignedLabel={t('deliveries.table.unassigned')} />,
                },
                {
                  key: 'createdAt', label: t('deliveries.table.date'), sortable: true,
                  render: (r: Delivery) => <DateCell delivery={r} />,
                },
                {
                  key: 'clientPhone', label: t('deliveries.table.clientPhone'),
                  render: (r: Delivery) => (
                    r.clientPhone
                      ? <span className={styles.phoneCell}>{r.clientPhone}</span>
                      : <span className={styles.mutedText}>—</span>
                  ),
                },
                {
                  key: 'amount', label: t('deliveries.table.amount'),
                  render: (r: Delivery) => <AmountCell amount={r.amount} />,
                },
                {
                  key: 'description', label: t('deliveries.table.description'),
                  render: (r: Delivery) => <DescriptionCell delivery={r} />,
                },
              ]}
              data={filtered}
              total={meta.total}
              page={page}
              limit={20}
              onPageChange={(p) => { setPage(p); setSelectedIds(new Set()); }}
              onEdit={(r) => { setEditing(r); setDrawerOpen(true); }}
              onDelete={(r) => setDeleting(r)}
              loading={false}
              emptyMessage=""
              keyExtractor={(r) => r.id}
            />
          </Card>
        )}
      </div>

      <EntityDialog
        open={drawerOpen}
        onClose={onCancel}
        title={drawerTitle}
        subtitle={drawerSubtitle}
        width={640}
        footer={
          <DialogSubmitBar
            form="entity-form"
            loading={deliveryForm.saving}
            onCancel={onCancel}
            submitLabel={editing ? t('deliveries.editDelivery') : t('deliveries.createDelivery')}
            error={deliveryForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={deliveryForm.handleSubmit}>
          <DialogSection title={t('deliveries.formSections.general')}>
            <DialogField label={t('deliveries.fields.title')} required
              error={deliveryForm.touched.has('title') ? deliveryForm.errors.title : null}>
              <input className="dialog-input" type="text"
                value={deliveryForm.values.title}
                onChange={(e) => deliveryForm.setValue('title', e.target.value)}
                onBlur={() => deliveryForm.handleBlur('title')}
                placeholder={t('deliveries.formPlaceholders.title')}
                autoFocus />
            </DialogField>

            <DialogField label={t('deliveries.fields.driver')}
              error={deliveryForm.touched.has('driverId') ? deliveryForm.errors.driverId : null}>
              <div>
                <select className="dialog-select"
                  value={deliveryForm.values.driverId}
                  onChange={(e) => deliveryForm.setValue('driverId', e.target.value)}
                  onBlur={() => deliveryForm.handleBlur('driverId')}>
                  <option value="">{t('deliveries.formPlaceholders.driver')}</option>
                  {drivers.filter((d) => d.isActive).map((d) => (
                    <option key={d.id} value={d.id}>{getDriverLabel(d)}</option>
                  ))}
                </select>
                {drivers.filter((d) => d.isActive).length === 0 && (
                  <div className={styles.driverEmptyText}>
                    {t('deliveries.formPlaceholders.noActiveDriver')}
                  </div>
                )}
              </div>
            </DialogField>
          </DialogSection>

          <DialogSection title={t('deliveries.formSections.addresses')}>
            <DialogField label={t('deliveries.fields.pickupLocation')} required
              error={deliveryForm.touched.has('pickupAddress') ? deliveryForm.errors.pickupAddress : null}>
              <LocationSearchInput
                placeholder={t('deliveries.formPlaceholders.pickup')}
                value={{
                  lat: deliveryForm.values.pickupLat ? parseFloat(deliveryForm.values.pickupLat) : null,
                  lng: deliveryForm.values.pickupLng ? parseFloat(deliveryForm.values.pickupLng) : null,
                  label: deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress,
                }}
                onChange={(v) => setLocationField('pickup', v)}
                onBlur={() => deliveryForm.handleBlur('pickupAddress')}
                recentPlaces={recentPlaces}
              />
            </DialogField>

            <DialogField label={t('deliveries.fields.deliveryLocation')} required
              error={deliveryForm.touched.has('deliveryAddress') ? deliveryForm.errors.deliveryAddress : null}>
              <LocationSearchInput
                placeholder={t('deliveries.formPlaceholders.delivery')}
                value={{
                  lat: deliveryForm.values.deliveryLat ? parseFloat(deliveryForm.values.deliveryLat) : null,
                  lng: deliveryForm.values.deliveryLng ? parseFloat(deliveryForm.values.deliveryLng) : null,
                  label: deliveryForm.values.deliveryLocationLabel || deliveryForm.values.deliveryAddress,
                }}
                onChange={(v) => setLocationField('delivery', v)}
                onBlur={() => deliveryForm.handleBlur('deliveryAddress')}
                recentPlaces={recentPlaces}
                showCopyButton={!!(deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress)}
                onCopyFromOther={copyPickupToDelivery}
                copyTooltip={t('deliveries.copyTooltip')}
              />
            </DialogField>
          </DialogSection>

          <div className={styles.advancedSection}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={styles.advancedToggle}
            >
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showAdvanced ? t('deliveries.advanced.hide') : t('deliveries.advanced.show')}
            </button>

            {showAdvanced && (
              <div className={styles.advancedContent}>
                <div className={styles.advancedGrid}>
                  <DialogField label={t('deliveries.fields.scheduledDate')}>
                    <input className="dialog-input" type="date"
                      value={deliveryForm.values.scheduledDate}
                      onChange={(e) => deliveryForm.setValue('scheduledDate', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('scheduledDate')} />
                  </DialogField>

                  <DialogField label={t('deliveries.fields.status')}>
                    <select className="dialog-select"
                      value={deliveryForm.values.status}
                      onChange={(e) => deliveryForm.setValue('status', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('status')}>
                      {Object.keys(STATUS_LABELS_KEY).map((k) => (
                        <option key={k} value={k}>{t(`deliveries.status.${k}`)}</option>
                      ))}
                    </select>
                  </DialogField>
                </div>

                <DialogField label={t('deliveries.fields.description')}>
                  <textarea className={`dialog-input ${styles.textareaField}`}
                    value={deliveryForm.values.description}
                    onChange={(e) => deliveryForm.setValue('description', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('description')}
                    placeholder={t('deliveries.formPlaceholders.description')}
                    rows={2} />
                </DialogField>

                <DialogField label={t('deliveries.fields.notes')}>
                  <textarea className={`dialog-input ${styles.textareaField}`}
                    value={deliveryForm.values.notes}
                    onChange={(e) => deliveryForm.setValue('notes', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('notes')}
                    placeholder={t('deliveries.formPlaceholders.notes')}
                    rows={3} />
                </DialogField>
              </div>
            )}
          </div>
        </form>
      </EntityDialog>

      {reverseLoading && (
        <div className={styles.reverseToast}>
          <Loader2 size={12} className={styles.spin} /> {t('deliveries.reverseGeocoding')}
        </div>
      )}

      {importReport && (
        <div
          onClick={() => setImportReport(null)}
          className={styles.importOverlay}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={styles.importModal}
          >
            <h2 className={styles.importTitle}>
              {t('deliveries.import.resultTitle')}
            </h2>
            <div className={styles.importStatsRow}>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: 'var(--color-teal, #3FA796)' }}>{importReport.created}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.created')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: 'var(--color-blue)' }}>{importReport.updated}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.updated')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: 'var(--color-accent)' }}>{importReport.skipped.length}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.skipped')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: 'var(--color-red)' }}>{importReport.errors.length}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.errors')}</div>
              </div>
            </div>

            {importReport.skipped.length > 0 && (
              <div className={styles.importSkippedSection}>
                <h3 className={styles.importSectionTitle}>
                  {t('deliveries.import.skippedTitle')}
                </h3>
                <div className={styles.importSkippedList}>
                  {importReport.skipped.map((s, i) => (
                    <div key={i} className={styles.importSkippedItem}>
                      <span className={styles.importSkippedRef}>{s.orderRef}</span>
                      <span className={styles.importSkippedReason}>
                        {s.reason === 'duplicate' ? t('deliveries.import.alreadyExists') : s.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importReport.errors.length > 0 && (
              <div className={styles.importErrorSection}>
                <h3 className={styles.importSectionTitle}>
                  {t('deliveries.import.errorsTitle')}
                </h3>
                <div className={styles.importErrorList}>
                  {importReport.errors.map((e, i) => (
                    <div key={i} className={styles.importErrorItem}>
                      {t('deliveries.import.errorRow', { row: e.row })} : {e.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.importCloseBtnRow}>
              <button
                onClick={() => setImportReport(null)}
                className={styles.importCloseBtn}
              >
                {t('deliveries.import.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('deliveries.confirmDelete.title')}
        message={
          deleting
            ? t('deliveries.confirmDelete.message', { title: deleting.title })
            : ''
        }
        variant="danger"
        confirmLabel={t('deliveries.confirmDelete.confirmLabel')}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}