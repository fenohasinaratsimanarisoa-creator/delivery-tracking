import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Search, Power, PowerOff, UsersRound, UserCheck, UserX, Users,
  Mail, Phone, Car, IdCard, Truck,
} from 'lucide-react';
import Button from '../components/Button';
import Badge from '../components/Badge';
import Card from '../components/Card';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import type { Driver, VehicleListItem } from '../types';
import styles from './DriversPage.module.css';
import { useCountUp } from '../hooks/useCountUp';

type ApiError = { response?: { data?: { message?: string } } };

interface DriverFormValues {
  firstName: string; lastName: string; email: string;
  phone: string; licenseNumber: string; vehicleId: string;
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

function DriverNameCell({ driver }: { driver: Driver }) {
  const initials = `${(driver.firstName[0] || '').toUpperCase()}${(driver.lastName[0] || '').toUpperCase()}`;
  return (
    <span className={styles.userCell}>
      <span className={styles.userAvatar}>{initials}</span>
      <span className={styles.userText}>
        <span className={styles.userName}>{driver.firstName} {driver.lastName}</span>
        <span className={styles.userEmail}>{driver.email || '—'}</span>
      </span>
    </span>
  );
}

function LicenseCell({ licenseNumber }: { licenseNumber: string }) {
  return (
    <span className={styles.licensePill}>
      <IdCard size={12} />
      {licenseNumber}
    </span>
  );
}

function VehicleCell({ vehicle }: { vehicle: Driver['vehicle'] }) {
  return vehicle ? (
    <span className={styles.vehicleCell}>
      <span className={styles.vehicleIcon}><Car size={13} /></span>
      <span className={styles.vehicleText}>
        <span className={styles.vehiclePlate}>{vehicle.licensePlate}</span>
        <span className={styles.vehicleModel}>{vehicle.brand} {vehicle.model}</span>
      </span>
    </span>
  ) : (
    <span className={styles.vehicleNone}>—</span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[42, 32, 26, 30, 36, 30, 20].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%`, animationDelay: `${(i + j) * 90}ms` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DriversPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading } = useQuery({
    queryKey: ['drivers', page],
    queryFn: () => api.get(`/drivers?page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles', 'list'],
    queryFn: () => api.get('/vehicles/list').then((r) => r.data),
  });
  const allVehicles: VehicleListItem[] = vehiclesData ?? [];

  const availableVehicles = useMemo(() => {
    return allVehicles.filter((v) => !v.driver || (editing && v.driver.id === editing.id));
  }, [allVehicles, editing]);

  const drivers: Driver[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  const filtered = useMemo(() => {
    if (!search.trim()) return drivers;
    const q = search.toLowerCase();
    return drivers.filter((d) =>
      `${d.firstName} ${d.lastName}`.toLowerCase().includes(q) ||
      (d.email || '').toLowerCase().includes(q) ||
      d.licenseNumber.toLowerCase().includes(q)
    );
  }, [drivers, search]);

  const stats = useMemo(() => ({
    total: meta.total ?? 0,
    active: drivers.filter((d) => d.isActive).length,
    inactive: drivers.filter((d) => !d.isActive).length,
    unassigned: drivers.filter((d) => !d.vehicle).length,
  }), [drivers, meta.total]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/drivers/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: DriverFormValues) => {
      const payload: Record<string, unknown> = {
        firstName: body.firstName,
        lastName: body.lastName,
        email: body.email || undefined,
        phone: body.phone || undefined,
        licenseNumber: body.licenseNumber,
      };
      if (body.vehicleId) payload.vehicleId = body.vehicleId;
      return editing ? api.patch(`/drivers/${editing.id}`, payload) : api.post('/drivers', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      const id = editing?.id || '';
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1500);
      toast(editing ? t('drivers.toast.updated') : t('drivers.toast.created'));
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('drivers.toast.saveError'), 'error');
    },
  });

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: t('drivers.noVehicle') }];
    for (const v of availableVehicles) {
      opts.push({
        value: v.id,
        label: `${v.licensePlate} — ${v.brand} ${v.model} (${v.fuelType})`,
      });
    }
    return opts;
  }, [availableVehicles, t]);

  const driverFields = useMemo<FieldDef<DriverFormValues>[]>(() => [
    { name: 'firstName', label: t('drivers.fields.firstName'), type: 'text', required: true, section: 'identity', autoFocus: true,
      rules: { minLength: 2, maxLength: 50 } },
    { name: 'lastName', label: t('drivers.fields.lastName'), type: 'text', required: true, section: 'identity',
      rules: { minLength: 2, maxLength: 50 } },
    { name: 'email', label: t('drivers.fields.email'), type: 'email', section: 'contact' },
    { name: 'phone', label: t('drivers.fields.phone'), type: 'tel', section: 'contact',
      rules: { pattern: /^0[1-9][0-9]{8}$/, patternMessage: t('drivers.validation.phoneFormat') } },
    { name: 'licenseNumber', label: t('drivers.fields.licenseNumber'), type: 'text', required: true, section: 'license',
      rules: { minLength: 3, maxLength: 30 } },
    { name: 'vehicleId', label: t('drivers.fields.vehicleId'), type: 'select', section: 'license' },
  ], [t]);

  const driverSections: FormSection[] = [
    { title: t('drivers.formSections.identity'), fields: ['firstName', 'lastName'] },
    { title: t('drivers.formSections.contact'), fields: ['email', 'phone'] },
    { title: t('drivers.formSections.license'), fields: ['licenseNumber', 'vehicleId'] },
  ];

  const driverForm = useEntityForm<DriverFormValues>({
    initial: editing ? {
      firstName: editing.firstName,
      lastName: editing.lastName,
      email: editing.email || '',
      phone: editing.phone || '',
      licenseNumber: editing.licenseNumber,
      vehicleId: editing.vehicleId || '',
    } : undefined,
    fields: driverFields.map(f => f.name === 'vehicleId' ? { ...f, options: vehicleOptions } : f),
    sections: driverSections,
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  useEffect(() => {
    if (drawerOpen) driverForm.reset();
  }, [drawerOpen, editing?.id]);

  const drawerTitle = editing ? `${editing.firstName} ${editing.lastName}` : '';
  const drawerSubtitle = editing
    ? `${t('drivers.editDriverSubtitle', { licenseNumber: editing.licenseNumber })} — ${t('drivers.vehicleAssignment')}`
    : '';
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><UsersRound size={24} /></div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('drivers.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('drivers.title')}</h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0 ? t('drivers.countSubtitle', { count: meta.total }) : t('drivers.fromUsersHint')}
          </p>
        </div>
      </header>

      <div className={styles.kpiGrid}>
        <KpiCard icon={<Truck size={18} />} label={t('drivers.kpis.total')} value={stats.total} color="var(--color-accent, #F2A93C)" />
        <KpiCard icon={<UserCheck size={18} />} label={t('drivers.kpis.active')} value={stats.active} color="var(--color-teal)" />
        <KpiCard icon={<UserX size={18} />} label={t('drivers.kpis.inactive')} value={stats.inactive} color="var(--color-text-tertiary, #7A8BA3)" />
        <KpiCard icon={<Car size={18} />} label={t('drivers.kpis.unassigned')} value={stats.unassigned} color="var(--color-blue, #3b82f6)" />
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder={t('drivers.searchPlaceholder')}
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {search && (
          <span className={styles.resultCount}>
            {t('drivers.resultCount', { count: filtered.length })}
          </span>
        )}
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {[t('drivers.table.name'), t('drivers.table.email'), t('drivers.table.phone'), t('drivers.table.license'), t('drivers.table.vehicle'), t('drivers.table.status'), ''].map((l) => (
                    <th key={l} className={styles.skeletonTh} style={{ textAlign: l === '' ? 'right' : 'left' }}>{l}</th>
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
            <span className={styles.emptyIconWrap}><Users size={26} /></span>
            <p className={styles.emptyTitle}>{search ? t('drivers.empty.noMatch') : t('drivers.empty.noData')}</p>
            <p className={styles.emptyDesc}>{search ? t('drivers.empty.tryDifferent') : t('drivers.fromUsersHint')}</p>
          </div>
        ) : (
          <Card flush animated >
            <DataTable
              columns={[
                {
                  key: 'name', label: t('drivers.table.name'), sortable: true,
                  render: (r: Driver) => <DriverNameCell driver={r} />,
                },
                {
                  key: 'email', label: t('drivers.table.email'), sortable: true,
                  render: (r: Driver) => (
                    <span className={styles.emailCell}><Mail size={12} />{r.email || '—'}</span>
                  ),
                },
                {
                  key: 'phone', label: t('drivers.table.phone'), sortable: false,
                  render: (r: Driver) => (
                    <span className={styles.phoneCell}><Phone size={12} />{r.phone || '—'}</span>
                  ),
                },
                {
                  key: 'licenseNumber', label: t('drivers.table.license'), sortable: true,
                  render: (r: Driver) => <LicenseCell licenseNumber={r.licenseNumber} />,
                },
                {
                  key: 'vehicle', label: t('drivers.table.vehicle'), sortable: false,
                  render: (r: Driver) => <VehicleCell vehicle={r.vehicle} />,
                },
                {
                  key: 'isActive', label: t('drivers.table.status'),
                  render: (r: Driver) => (
                    <span className={styles.statusCell}>
                      <Badge variant={r.isActive ? 'teal' : 'neutral'} size="sm" dot>
                        {r.isActive ? t('drivers.status.active') : t('drivers.status.inactive')}
                      </Badge>
                      <Button
                        variant={r.isActive ? 'ghost' : 'outline'}
                        size="sm"
                        icon={r.isActive ? <Power size={14} /> : <PowerOff size={14} />}
                        onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                        title={r.isActive ? t('drivers.status.deactivate') : t('drivers.status.activate')}
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
            loading={driverForm.saving}
            onCancel={onCancel}
            submitLabel={t('common.save') || 'Enregistrer'}
            error={driverForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={driverForm.handleSubmit}>
          {driverSections.map((sec) => (
            <DialogSection key={sec.title} title={sec.title}>
              {sec.fields.map((fieldName) => {
                const def = driverFields.find((f) => f.name === fieldName)!;
                const effectiveDef = fieldName === 'vehicleId'
                  ? { ...def, options: vehicleOptions }
                  : def;
                const val = driverForm.values[fieldName as keyof DriverFormValues] as string;
                const err = driverForm.touched.has(fieldName) ? driverForm.errors[fieldName] : null;
                return (
                  <DialogField key={fieldName} label={effectiveDef.label} error={err} required={effectiveDef.required}>
                    {effectiveDef.type === 'select' ? (
                      <select
                        className="dialog-select"
                        value={val}
                        onChange={(e) => driverForm.setValue(fieldName as keyof DriverFormValues, e.target.value)}
                        onBlur={() => driverForm.handleBlur(fieldName as keyof DriverFormValues)}
                        disabled={fieldName !== 'vehicleId'}
                      >
                        {effectiveDef.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="dialog-input"
                        type={effectiveDef.type || 'text'}
                        value={val}
                        onChange={(e) => driverForm.setValue(fieldName as keyof DriverFormValues, e.target.value)}
                        onBlur={() => driverForm.handleBlur(fieldName as keyof DriverFormValues)}
                        placeholder={effectiveDef.placeholder || ''}
                        autoFocus={effectiveDef.autoFocus}
                        readOnly={fieldName !== 'vehicleId'}
                      />
                    )}
                  </DialogField>
                );
              })}
            </DialogSection>
          ))}
        </form>
      </EntityDialog>
    </div>
  );
}