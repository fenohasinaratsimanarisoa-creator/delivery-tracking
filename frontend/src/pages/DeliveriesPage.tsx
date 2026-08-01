import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Search, ChevronDown, ChevronUp, Upload } from 'lucide-react';
import Button from '../components/Button';
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

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', assigned: '#06b6d4', in_progress: '#3b82f6',
  delivered: '#22c55e', failed: '#ef4444', cancelled: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente', assigned: 'Assigné', in_progress: 'En cours',
  delivered: 'Livré', failed: 'Échoué', cancelled: 'Annulé',
};

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[40, 35, 30, 25, 20].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DeliveriesPage() {
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [deleting, setDeleting] = useState<Delivery | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation();
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
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      }).then((r) => r.data);
    },
    onSuccess: (report: { created: number; updated: number; skipped: { row: number; orderRef: string; reason: string }[]; errors: { row: number; reason: string }[] }) => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      setImporting(false);
      setImportReport(report);
      const parts: string[] = [];
      if (report.created > 0) parts.push(`${report.created} créée${report.created > 1 ? 's' : ''}`);
      if (report.updated > 0) parts.push(`${report.updated} mise${report.updated > 1 ? 's' : ''} à jour`);
      if (report.skipped.length > 0) parts.push(`${report.skipped.length} déjà existante${report.skipped.length > 1 ? 's' : ''}`);
      if (report.errors.length > 0) parts.push(`${report.errors.length} erreur${report.errors.length > 1 ? 's' : ''}`);
      if (parts.length > 0) toast(parts.join(', ') + ' — voir détail');
      else toast('Aucune donnée importée');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: ApiError) => {
      setImporting(false);
      toast(err?.response?.data?.message || 'Erreur lors de l\'import Excel', 'error');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.match(/\.xlsx$/i)) {
      toast('Format de fichier invalide, .xlsx attendu', 'error');
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
        toast(`${report.succeeded.length} succès, ${report.failed.length} échecs : ${report.failed[0].reason}`, 'error');
      } else {
        toast(`${report.succeeded.length} livraison${report.succeeded.length > 1 ? 's' : ''} mise${report.succeeded.length > 1 ? 's' : ''} à jour`);
      }
      setSelectedIds(new Set());
    },
    onError: (err: ApiError) => {
      setBulkActionLoading(false);
      toast(err?.response?.data?.message || 'Erreur lors de l\'action groupée', 'error');
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
      toast(editing ? 'Livraison modifiée' : 'Livraison créée');
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.userMessage || err?.response?.data?.message || "Erreur lors de l'enregistrement", 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Livraison supprimée');
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const resolveMismatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/deliveries/${id}/resolve-mismatch`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Alerte marquée comme traitée');
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
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

  const drawerTitle = editing ? editing.title : 'Nouvelle livraison';
  const drawerSubtitle = editing
    ? STATUS_LABELS[editing.status] || editing.status
    : 'Titre, adresses et chauffeur en une seule étape';
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
    <div className={`page-padding ${styles.pageContainer}`}>
      <style>{`
        @keyframes dt-row-highlight {
          0% { background: var(--color-accent-muted); }
          100% { background: transparent; }
        }
      `}</style>

      <div className={styles.headerRow}>
        <div className={styles.headerTitleWrapper}>
          <h1 className={`page-title ${styles.pageTitle}`}>
            Livraisons
          </h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0 ? `${meta.total} livraison${meta.total > 1 ? 's' : ''}` : 'Gérez les livraisons de votre flotte'}
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
              {importing ? 'Import en cours…' : 'Importer Excel'}
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
            Nouvelle livraison
          </Button>
        </div>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder="Rechercher une livraison…"
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className={styles.bulkActionBar}>
          <span className={styles.bulkActionCount}>
            {selectedIds.size} livraison{selectedIds.size > 1 ? 's' : ''} sélectionnée{selectedIds.size > 1 ? 's' : ''}
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
            <option value="">Changer le statut…</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
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
            <option value="">Assigner un chauffeur…</option>
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
            Supprimer
          </button>
          {bulkActionLoading && <span className={styles.bulkLoadingText}>En cours…</span>}
          <button
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkActionLoading}
            className={styles.clearSelectionBtn}
          >
            Tout désélectionner
          </button>
        </div>
      )}

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {['Titre', 'Statut', 'Adresse livraison', 'Chauffeur', 'Date', 'Description', ''].map((l) => (
                    <th key={l} className={styles.skeletonTh} style={{ textAlign: l === '' ? 'right' : 'left' }}>
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
            <div className={styles.emptyStateIcon}>
              <Plus size={24} />
            </div>
            <p className={styles.emptyStateTitle}>
              {search ? 'Aucune livraison ne correspond' : 'Aucune livraison enregistrée'}
            </p>
            <p className={styles.emptyStateDesc}>
              {search ? 'Essayez un autre terme' : 'Créez votre première livraison'}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                Nouvelle livraison
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            selectable
            selectedIds={selectedIds}
            onSelectionChange={(ids) => {
              setSelectedIds(ids);
            }}
            columns={[
              { key: 'title', label: 'Titre', sortable: true },
              {
                key: 'status', label: 'Statut', sortable: true,
                render: (r: Delivery) => (
                  <div className={styles.statusColumn}>
                    <span className={styles.statusBadge}
                      style={{
                        background: `${STATUS_COLORS[r.status] || '#6b7280'}20`,
                        color: STATUS_COLORS[r.status] || '#6b7280',
                      }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                    {r.locationMismatch && !r.mismatchResolved && (
                      <div className={styles.mismatchAlert}>
                        <span style={{ fontSize: '0.75rem' }}>⚠️</span>
                        <span>{r.deliveryProofDistance != null ? `${r.deliveryProofDistance}m d'écart` : 'Écart détecté'}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); resolveMismatchMutation.mutate(r.id); }}
                          disabled={resolveMismatchMutation.isPending}
                          className={styles.mismatchResolveBtn}
                        >
                          ✓ Traité
                        </button>
                      </div>
                    )}
                  </div>
                ),
              },
              { key: 'deliveryAddress', label: 'Adresse de livraison' },
              {
                key: 'driver', label: 'Chauffeur',
                render: (r: Delivery) => (
                  r.driver
                    ? `${r.driver.firstName} ${r.driver.lastName}`
                    : <span className={styles.textMuted}>Non assigné</span>
                ),
              },
              {
                key: 'createdAt', label: 'Date', sortable: true,
                render: (r: Delivery) => (
                  <div>
                    <div className={styles.dateText}>
                      {formatDate(r.createdAt)}
                    </div>
                    {r.scheduledDate && (
                      <div className={styles.scheduledDate}>
                        📅 {formatDate(r.scheduledDate)}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'clientPhone', label: 'Tél.',
                render: (r: Delivery) => (
                  r.clientPhone
                    ? <span className={styles.monoText}>{r.clientPhone}</span>
                    : <span className={styles.textMuted}>—</span>
                ),
              },
              {
                key: 'amount', label: 'Montant',
                render: (r: Delivery) => (
                  r.amount !== undefined && r.amount !== null
                    ? <span className={styles.semiBoldMono}>{formatAriary(r.amount)}</span>
                    : <span className={styles.textMuted}>—</span>
                ),
              },
              {
                key: 'description', label: 'Description',
                render: (r: Delivery) => (
                  <span className={styles.descriptionText}>
                    {r.productDescription || r.description || (r.notes
                      ? <span className={styles.notesItalic}>📝 {r.notes.slice(0, 60)}</span>
                      : <span className={styles.textMuted}>—</span>
                    )}
                  </span>
                ),
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
            submitLabel={editing ? 'Enregistrer' : 'Créer la livraison'}
            error={deliveryForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={deliveryForm.handleSubmit}>
          {/* === SECTION 1: Infos principales === */}
          <DialogSection title="Informations principales">
            <DialogField label="Titre de la livraison" required
              error={deliveryForm.touched.has('title') ? deliveryForm.errors.title : null}>
              <input className="dialog-input" type="text"
                value={deliveryForm.values.title}
                onChange={(e) => deliveryForm.setValue('title', e.target.value)}
                onBlur={() => deliveryForm.handleBlur('title')}
                placeholder="Ex: Livraison Analamanga 45"
                autoFocus />
            </DialogField>

            <DialogField label="Chauffeur"
              error={deliveryForm.touched.has('driverId') ? deliveryForm.errors.driverId : null}>
              <div>
                <select className="dialog-select"
                  value={deliveryForm.values.driverId}
                  onChange={(e) => deliveryForm.setValue('driverId', e.target.value)}
                  onBlur={() => deliveryForm.handleBlur('driverId')}>
                  <option value="">Sélectionner un chauffeur…</option>
                  {drivers.filter((d) => d.isActive).map((d) => (
                    <option key={d.id} value={d.id}>{getDriverLabel(d)}</option>
                  ))}
                </select>
                {drivers.filter((d) => d.isActive).length === 0 && (
                  <div className={styles.driverEmptyText}>
                    Aucun chauffeur actif disponible
                  </div>
                )}
              </div>
            </DialogField>
          </DialogSection>

          {/* === SECTION 2: Adresses === */}
          <DialogSection title="Adresses">
            <DialogField label="Point d'enlèvement" required
              error={deliveryForm.touched.has('pickupAddress') ? deliveryForm.errors.pickupAddress : null}>
              <LocationSearchInput
                placeholder="Ex: Analakely Antananarivo…"
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

            <DialogField label="Point de livraison" required
              error={deliveryForm.touched.has('deliveryAddress') ? deliveryForm.errors.deliveryAddress : null}>
              <LocationSearchInput
                placeholder="Ex: Ivato Antananarivo…"
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
                copyTooltip="Même adresse que l'enlèvement"
              />
            </DialogField>
          </DialogSection>

          {/* === SECTION 3: Options avancées (repliables) === */}
          <div className={styles.advancedSection}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={styles.advancedToggle}
            >
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showAdvanced ? 'Masquer les options avancées' : 'Options avancées'}
            </button>

            {showAdvanced && (
              <div className={styles.advancedContent}>
                <div className={styles.advancedGrid}>
                  <DialogField label="Date planifiée">
                    <input className="dialog-input" type="date"
                      value={deliveryForm.values.scheduledDate}
                      onChange={(e) => deliveryForm.setValue('scheduledDate', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('scheduledDate')} />
                  </DialogField>

                  <DialogField label="Statut">
                    <select className="dialog-select"
                      value={deliveryForm.values.status}
                      onChange={(e) => deliveryForm.setValue('status', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('status')}>
                      <option value="pending">En attente</option>
                      <option value="assigned">Assigné</option>
                      <option value="in_progress">En cours</option>
                      <option value="delivered">Livré</option>
                      <option value="failed">Échoué</option>
                      <option value="cancelled">Annulé</option>
                    </select>
                  </DialogField>
                </div>

                <DialogField label="Description">
                  <textarea className={`dialog-input ${styles.textareaField}`}
                    value={deliveryForm.values.description}
                    onChange={(e) => deliveryForm.setValue('description', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('description')}
                    placeholder="Description détaillée de la livraison…"
                    rows={2} />
                </DialogField>

                <DialogField label="Notes / Instructions chauffeur">
                  <textarea className={`dialog-input ${styles.textareaField}`}
                    value={deliveryForm.values.notes}
                    onChange={(e) => deliveryForm.setValue('notes', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('notes')}
                    placeholder="Instructions particulières, informations complémentaires…"
                    rows={3} />
                </DialogField>
              </div>
            )}
          </div>
        </form>
      </EntityDialog>

      {reverseLoading && (
        <div className={styles.reverseToast}>
          Recherche des adresses…
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
                <div className={styles.importStatNumber} style={{ color: '#22c55e' }}>{importReport.created}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.created')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: '#3b82f6' }}>{importReport.updated}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.updated')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: '#f59e0b' }}>{importReport.skipped.length}</div>
                <div className={styles.importStatLabel}>{t('deliveries.import.stats.skipped')}</div>
              </div>
              <div className={styles.importStatCard}>
                <div className={styles.importStatNumber} style={{ color: '#ef4444' }}>{importReport.errors.length}</div>
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
                  Erreurs
                </h3>
                <div className={styles.importErrorList}>
                  {importReport.errors.map((e, i) => (
                    <div key={i} className={styles.importErrorItem}>
                      Ligne {e.row} : {e.reason}
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
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la livraison"
        message={
          deleting
            ? `Supprimer "${deleting.title}" ? Cette action est irréversible.`
            : ''
        }
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
