import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Search, Power, PowerOff, Plus, Truck, CarFront, Fuel, Zap, Droplets,
  Battery, Flame, IdCard, CheckCircle2, CircleOff, UserCheck, SearchX,
  AlertTriangle,
} from 'lucide-react';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Card from '../components/Card';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import { useAuth } from '../hooks/AuthContext';
import type { Vehicle } from '../types';
import styles from './FleetPage.module.css';

type ApiError = { response?: { data?: { message?: string } } };

interface VehicleFormValues {
  brand: string; model: string; year: string;
  licensePlate: string; fuelType: string;
  vin: string; theoreticalConsumption: string;
  positionSource: string; traccarDeviceId: string;
}

function useCountUp(target: number, duration = 650) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

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

// Couleurs des carburants branchées sur les tokens du thème. Électrique → teal,
// Hybride → cyan (token dédié, distinct du teal pour garder les deux distinguables
// dans la même liste). Fond/bordure teintés via color-mix() (compatible var() CSS).
const FUEL_TONES: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  'Essence': { color: 'var(--color-accent)', bg: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', icon: <Droplets size={13} /> },
  'Diesel': { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 14%, transparent)', icon: <Fuel size={13} /> },
  'Électrique': { color: 'var(--color-teal)', bg: 'color-mix(in srgb, var(--color-teal) 14%, transparent)', icon: <Zap size={13} /> },
  'Hybride Essence': { color: 'var(--color-cyan)', bg: 'color-mix(in srgb, var(--color-cyan) 14%, transparent)', icon: <Battery size={13} /> },
  'Hybride Diesel': { color: 'var(--color-cyan)', bg: 'color-mix(in srgb, var(--color-cyan) 14%, transparent)', icon: <Battery size={13} /> },
  'GPL': { color: 'var(--color-purple)', bg: 'color-mix(in srgb, var(--color-purple) 14%, transparent)', icon: <Flame size={13} /> },
};

function VehicleNameCell({ vehicle }: { vehicle: Vehicle }) {
  return (
    <span className={styles.vehicleNameCell}>
      <span className={styles.vehicleAvatar}>
        <CarFront size={15} />
      </span>
      <span className={styles.vehicleNameText}>
        <span className={styles.vehicleName}>{vehicle.brand}</span>
        <span className={styles.vehicleModel}>{vehicle.model}</span>
      </span>
    </span>
  );
}

function PlateCell({ plate }: { plate: string }) {
  return (
    <span className={styles.platePill}>
      <IdCard size={12} />
      {plate}
    </span>
  );
}

function FuelCell({ fuelType }: { fuelType: string }) {
  const tone = FUEL_TONES[fuelType] ?? { color: 'var(--color-text-tertiary)', bg: 'color-mix(in srgb, var(--color-text-tertiary) 14%, transparent)', icon: <Fuel size={13} /> };
  return (
    <span className={styles.fuelPill} style={{ color: tone.color, background: tone.bg, borderColor: `color-mix(in srgb, ${tone.color} 20%, transparent)` }}>
      {tone.icon}
      {fuelType}
    </span>
  );
}

// Tracking peu fiable : le chauffeur n'a pas accordé un réglage OS requis
// (exemption batterie, permission "Toujours", ou surcouche OEM agressive
// type Xiaomi/Huawei/Oppo) — le tracking peut se couper silencieusement en
// arrière-plan (Doze) sans que rien ne le signale avant un rapport carburant
// "GPS insuffisant" des jours plus tard. Cf. useDriverTracking.ts (source de
// la donnée, poussée via PATCH /tracking/reliability-status).
type TrackingReliability = 'reliable' | 'battery_opt_not_ignored' | 'background_perm_missing' | 'oem_restricted';

function TrackingReliabilityBadge({ status }: { status?: TrackingReliability }) {
  const { t } = useTranslation();
  if (!status || status === 'reliable') return null;
  const message = t(`fleet.trackingReliability.messages.${status}`, {
    defaultValue: t('fleet.trackingReliability.messages.default'),
  });
  return (
    <span title={message} data-testid="tracking-reliability-badge">
      <Badge variant="orange" size="sm" icon={<AlertTriangle size={12} />}>
        {t('fleet.trackingReliability.badge')}
      </Badge>
    </span>
  );
}

function DriverCell({ driver }: { driver: Vehicle['driver'] }) {
  if (!driver) return <span className={styles.driverNone}>—</span>;
  const initials = `${(driver.firstName[0] || '').toUpperCase()}${(driver.lastName[0] || '').toUpperCase()}`;
  return (
    <span className={styles.driverCell}>
      <span className={styles.driverAvatar}>{initials}</span>
      <span className={styles.driverName}>{driver.firstName} {driver.lastName}</span>
      <TrackingReliabilityBadge status={driver.trackingReliability} />
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[36, 32, 18, 26, 30, 34, 28].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%`, animationDelay: `${(i + j) * 90}ms` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function FleetPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // DELETE /vehicles/:id est réservé admin (contrôleur backend) : un
  // dispatcher verrait le bouton puis un 403 — on masque les actions delete.
  const canDelete = user?.role === 'admin';
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceId, setNewDeviceId] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', page],
    queryFn: () => api.get(`/vehicles?page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: traccarDevices } = useQuery({
    queryKey: ['traccar-devices'],
    queryFn: () => api.get('/vehicles/available-traccar-devices').then((r) => r.data),
    staleTime: 30000,
  });

  const vehicles: Vehicle[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  const stats = {
    total: vehicles.length,
    active: vehicles.filter((v) => v.isActive).length,
    inactive: vehicles.filter((v) => !v.isActive).length,
    withDriver: vehicles.filter((v) => v.driver).length,
  };

  const filtered = useMemo(() => {
    if (!search.trim()) return vehicles;
    const q = search.toLowerCase();
    return vehicles.filter((v) =>
      v.brand.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q) ||
      v.licensePlate.toLowerCase().includes(q)
    );
  }, [vehicles, search]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      toast(t('fleet.toast.deleted'));
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fleet.toast.deleteError'), 'error');
      setDeleting(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/vehicles/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const addDeviceMutation = useMutation({
    mutationFn: (body: { name: string; uniqueId: string }) =>
      api.post('/vehicles/traccar-devices', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['traccar-devices'] });
      toast(t('fleet.toast.deviceAdded'));
      setShowAddDevice(false);
      setNewDeviceName('');
      setNewDeviceId('');
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fleet.toast.deviceError'), 'error');
    },
  });

  const traccarDeviceOptions = ((traccarDevices ?? []) as { id: string; name: string }[]).map((d) => ({
    value: String(d.id),
    label: `${d.name} (ID: ${d.id})`,
  }));

  const vehicleFields: FieldDef<VehicleFormValues>[] = [
    { name: 'brand', label: t('fleet.fields.brand'), type: 'text', required: true, section: 'identity', autoFocus: true,
      rules: { minLength: 2, maxLength: 50 } },
    { name: 'model', label: t('fleet.fields.model'), type: 'text', required: true, section: 'identity',
      rules: { minLength: 1, maxLength: 50 } },
    { name: 'year', label: t('fleet.fields.year'), type: 'number', required: true, section: 'identity',
      rules: { minLength: 4, maxLength: 4, pattern: /^\d{4}$/, patternMessage: t('fleet.validation.invalidYear') } },
    { name: 'licensePlate', label: t('fleet.fields.licensePlate'), type: 'text', required: true, section: 'registration',
      rules: { minLength: 4, maxLength: 15 } },
    { name: 'vin', label: t('fleet.fields.vin'), type: 'text', section: 'registration',
      rules: { maxLength: 17 } },
    { name: 'fuelType', label: t('fleet.fields.fuelType'), type: 'select', required: true, section: 'specs',
      options: [
        { value: 'Essence', label: t('fleet.fuelTypes.gasoline') },
        { value: 'Diesel', label: t('fleet.fuelTypes.diesel') },
        { value: 'Électrique', label: t('fleet.fuelTypes.electric') },
        { value: 'Hybride Essence', label: t('fleet.fuelTypes.hybrid') },
        { value: 'Hybride Diesel', label: t('fleet.fuelTypes.hybridDiesel') },
        { value: 'GPL', label: t('fleet.fuelTypes.lpg') },
      ] },
    { name: 'theoreticalConsumption', label: t('fleet.fields.theoreticalConsumption'), type: 'number', section: 'specs' },
    { name: 'positionSource', label: t('fleet.fields.positionSource'), type: 'select', required: true, section: 'gps',
      options: [
        { value: 'phone', label: t('fleet.positionSources.phone') },
        { value: 'physical_tracker', label: t('fleet.positionSources.tracker') },
      ] },
    { name: 'traccarDeviceId', label: t('fleet.fields.traccarDeviceId'), type: 'select', section: 'gps' },
  ];

  const vehicleSections: FormSection[] = [
    { title: t('fleet.formSections.identity'), fields: ['brand', 'model', 'year'] },
    { title: t('fleet.formSections.registration'), fields: ['licensePlate', 'vin'] },
    { title: t('fleet.formSections.features'), fields: ['fuelType', 'theoreticalConsumption'] },
    { title: t('fleet.formSections.positionSource'), fields: ['positionSource', 'traccarDeviceId'] },
  ];

  const fieldsWithTraccar = useMemo(() => {
    return vehicleFields.map((f) => {
      if (f.name === 'traccarDeviceId') {
        return { ...f, options: traccarDeviceOptions };
      }
      return f;
    });
  }, [traccarDeviceOptions]);

  const saveMutation = useMutation({
    mutationFn: (body: VehicleFormValues) => {
      const payload: Record<string, unknown> = {
        brand: body.brand,
        model: body.model,
        year: Number(body.year),
        licensePlate: body.licensePlate,
        fuelType: body.fuelType,
        positionSource: body.positionSource || 'phone',
      };
      if (body.vin) payload.vin = body.vin;
      else if (editing) payload.vin = '';
      if (body.theoreticalConsumption) payload.theoreticalConsumption = Number(body.theoreticalConsumption);
      else if (editing) payload.theoreticalConsumption = null;
      if (body.positionSource === 'physical_tracker' && body.traccarDeviceId) {
        payload.traccarDeviceId = body.traccarDeviceId;
      }
      return editing
        ? api.patch(`/vehicles/${editing.id}`, payload)
        : api.post('/vehicles', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      const id = editing?.id || '';
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1500);
      toast(editing ? t('fleet.toast.updated') : t('fleet.toast.created'));
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('fleet.toast.saveError'), 'error');
    },
  });

  const vehicleForm = useEntityForm<VehicleFormValues>({
    initial: editing ? {
      brand: editing.brand,
      model: editing.model,
      year: String(editing.year),
      licensePlate: editing.licensePlate,
      fuelType: editing.fuelType,
      // Pré-saisie réelle des valeurs existantes : avant ce fix, vin et
      // consommation théorique démarraient toujours vides en édition (et
      // théoriquement jamais renvoyées au serveur) — toute édition les effaçait.
      vin: editing.vin ?? '',
      theoreticalConsumption: editing.theoreticalConsumption != null ? String(editing.theoreticalConsumption) : '',
      positionSource: editing.positionSource || 'phone',
      traccarDeviceId: editing.traccarDeviceId || '',
    } : { brand: '', model: '', year: String(new Date().getFullYear()), licensePlate: '', fuelType: 'Diesel', vin: '', theoreticalConsumption: '', positionSource: 'phone', traccarDeviceId: '' },
    fields: fieldsWithTraccar,
    sections: vehicleSections,
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  useEffect(() => {
    if (drawerOpen) vehicleForm.reset();
  }, [drawerOpen, editing?.id]);

  const drawerTitle = editing
    ? `${editing.brand} ${editing.model} (${editing.licensePlate})`
    : t('fleet.newVehicle');
  const drawerSubtitle = editing
    ? t('fleet.editSubtitle', { year: editing.year, fuelType: editing.fuelType })
    : t('fleet.drawerSubtitle');
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><Truck size={24} /></div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('fleet.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('fleet.title')}</h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0
              ? t(meta.total > 1 ? 'fleet.count_plural' : 'fleet.count', { count: meta.total })
              : t('fleet.subtitle')}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={16} />}
          onClick={() => { setEditing(null); setDrawerOpen(true); }}
        >
          {t('fleet.newVehicle')}
        </Button>
      </header>

      <div className={styles.kpiGrid}>
        <KpiCard icon={<Truck size={18} />} label={t('fleet.kpis.total')} value={stats.total} color="var(--color-accent, #F2A93C)" />
        <KpiCard icon={<CheckCircle2 size={18} />} label={t('fleet.kpis.active')} value={stats.active} color="var(--color-teal)" />
        <KpiCard icon={<CircleOff size={18} />} label={t('fleet.kpis.inactive')} value={stats.inactive} color="var(--color-text-tertiary, #7A8BA3)" />
        <KpiCard icon={<UserCheck size={18} />} label={t('fleet.kpis.withDriver')} value={stats.withDriver} color="var(--color-blue, #3b82f6)" />
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder={t('fleet.searchPlaceholder')}
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {search && (
          <span className={styles.resultCount}>
            {t(search.length > 1 ? 'fleet.resultCount_plural' : 'fleet.resultCount', { count: filtered.length })}
          </span>
        )}
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {[
                    t('fleet.table.brand'),
                    t('fleet.table.model'),
                    t('fleet.table.year'),
                    t('fleet.table.licensePlate'),
                    t('fleet.table.driver'),
                    t('fleet.table.status'),
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
              <SearchX size={26} />
            </div>
            <p className={styles.emptyTitle}>
              {search ? t('fleet.empty.noMatch') : t('fleet.empty.noData')}
            </p>
            <p className={styles.emptyDesc}>
              {search ? t('fleet.empty.tryDifferent') : t('fleet.empty.createFirst')}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                {t('fleet.createVehicle')}
              </Button>
            )}
          </div>
        ) : (
          <Card flush animated >
            <DataTable
              columns={[
                {
                  key: 'brand', label: t('fleet.table.brand'), sortable: true,
                  render: (r: Vehicle) => <VehicleNameCell vehicle={r} />,
                },
                {
                  key: 'year', label: t('fleet.table.year'), sortable: true,
                  render: (r: Vehicle) => <span className={styles.yearText}>{r.year}</span>,
                },
                {
                  key: 'licensePlate', label: t('fleet.table.licensePlate'), sortable: true,
                  render: (r: Vehicle) => <PlateCell plate={r.licensePlate} />,
                },
                {
                  key: 'fuelType', label: t('fleet.table.fuelType'), sortable: true,
                  render: (r: Vehicle) => <FuelCell fuelType={r.fuelType} />,
                },
                {
                  key: 'driver', label: t('fleet.table.driver'),
                  render: (r: Vehicle) => <DriverCell driver={r.driver} />,
                },
                {
                  key: 'isActive', label: t('fleet.table.status'),
                  render: (r: Vehicle) => (
                    <span className={styles.statusCell}>
                      <Badge variant={r.isActive ? 'teal' : 'neutral'} size="sm" dot>
                        {r.isActive ? t('fleet.status.active') : t('fleet.status.inactive')}
                      </Badge>
                      <Button
                        variant={r.isActive ? 'ghost' : 'outline'}
                        size="sm"
                        icon={r.isActive ? <Power size={14} /> : <PowerOff size={14} />}
                        onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                        title={r.isActive ? t('fleet.status.deactivate') : t('fleet.status.activate')}
                      />
                    </span>
                  ),
                },
              ]}
              data={filtered}
              total={meta.total}
              page={page}
              limit={20}
              onPageChange={setPage}
              onEdit={(r) => { setEditing(r); setDrawerOpen(true); }}
              onDelete={canDelete ? (r) => setDeleting(r) : undefined}
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
        footer={
          <DialogSubmitBar
            form="entity-form"
            loading={vehicleForm.saving}
            onCancel={onCancel}
            submitLabel={editing ? t('fleet.editVehicle') : t('fleet.createVehicle')}
            error={vehicleForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={vehicleForm.handleSubmit}>
          {vehicleSections.map((sec) => (
            <DialogSection key={sec.title} title={sec.title}>
              {sec.fields.map((fieldName) => {
                const def = fieldsWithTraccar.find((f) => f.name === fieldName)!;
                if (fieldName === 'traccarDeviceId' && vehicleForm.values.positionSource !== 'physical_tracker') {
                  return null;
                }
                const val = vehicleForm.values[fieldName as keyof VehicleFormValues] as string;
                const err = vehicleForm.touched.has(fieldName) ? vehicleForm.errors[fieldName] : null;
                return (
                  <DialogField key={fieldName} label={def.label} error={err} required={def.required}>
                    {def.type === 'select' ? (
                      <div className={styles.formSelectWrapper}>
                        <select
                          className="dialog-select"
                          value={val}
                          onChange={(e) => vehicleForm.setValue(fieldName as keyof VehicleFormValues, e.target.value)}
                          onBlur={() => vehicleForm.handleBlur(fieldName as keyof VehicleFormValues)}
                          style={{ flex: 1 }}
                        >
                          {def.name === 'traccarDeviceId' && (
                            <option value="">{t('fleet.selectDevicePlaceholder')}</option>
                          )}
                          {def.options?.map((o: { value: string; label: string }) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {def.name === 'traccarDeviceId' && (
                          <button
                            type="button"
                            onClick={() => setShowAddDevice(true)}
                            title={t('fleet.addDeviceHint')}
                            className={styles.addDeviceBtn}
                          >
                            <Plus size={14} /> {t('fleet.addDevice')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <input
                        className="dialog-input"
                        type={def.type || 'text'}
                        value={val}
                        onChange={(e) => vehicleForm.setValue(fieldName as keyof VehicleFormValues, e.target.value)}
                        onBlur={() => vehicleForm.handleBlur(fieldName as keyof VehicleFormValues)}
                        placeholder={def.placeholder || ''}
                        autoFocus={def.autoFocus}
                      />
                    )}
                  </DialogField>
                );
              })}
            </DialogSection>
          ))}
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deleting}
        title={t('fleet.confirmDelete.title')}
        message={
          deleting
            ? t('fleet.confirmDelete.message', { brand: deleting.brand, model: deleting.model, licensePlate: deleting.licensePlate, year: deleting.year })
            : ''
        }
        variant="danger"
        confirmLabel={t('fleet.deleteConfirmLabel')}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />

      {showAddDevice && (
        <div className={styles.modalOverlay}>
          <div
            onClick={() => setShowAddDevice(false)}
            className={styles.modalBackdrop}
          />
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>
              {t('fleet.modalDevice.title')}
            </h3>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                {t('fleet.modalDevice.nameLabel')} *
              </label>
              <input
                className="dialog-input"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                placeholder={t('fleet.modalDevice.namePlaceholder')}
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                {t('fleet.modalDevice.imeiLabel')} *
              </label>
              <input
                className="dialog-input"
                value={newDeviceId}
                onChange={(e) => setNewDeviceId(e.target.value)}
                placeholder={t('fleet.modalDevice.imeiPlaceholder')}
              />
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setShowAddDevice(false)}
                className={styles.cancelBtn}
              >
                {t('fleet.modalDevice.cancel')}
              </button>
              <button
                type="button"
                disabled={!newDeviceName.trim() || !newDeviceId.trim() || addDeviceMutation.isPending}
                onClick={() => addDeviceMutation.mutate({ name: newDeviceName.trim(), uniqueId: newDeviceId.trim() })}
                className={styles.submitBtn}
                style={{ opacity: (!newDeviceName.trim() || !newDeviceId.trim()) ? 0.5 : 1 }}
              >
                {addDeviceMutation.isPending ? t('fleet.modalDevice.adding') : t('fleet.modalDevice.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}