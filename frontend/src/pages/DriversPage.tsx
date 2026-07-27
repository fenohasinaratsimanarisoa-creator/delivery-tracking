import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Power, PowerOff } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import type { Driver, VehicleListItem } from '../types';
import styles from './DriversPage.module.css';

type ApiError = { response?: { data?: { message?: string } } };

interface DriverFormValues {
  firstName: string; lastName: string; email: string;
  phone: string; licenseNumber: string; vehicleId: string;
}

const driverFields: FieldDef<DriverFormValues>[] = [
  { name: 'firstName', label: 'Prénom', type: 'text', required: true, section: 'identity', autoFocus: true,
    rules: { minLength: 2, maxLength: 50 } },
  { name: 'lastName', label: 'Nom', type: 'text', required: true, section: 'identity',
    rules: { minLength: 2, maxLength: 50 } },
  { name: 'email', label: 'Email professionnel', type: 'email', section: 'contact' },
  { name: 'phone', label: 'Téléphone', type: 'tel', section: 'contact',
    rules: { pattern: /^0[1-9][0-9]{8}$/, patternMessage: 'Le numéro doit commencer par 0 et faire 10 chiffres' } },
  { name: 'licenseNumber', label: 'Numéro de permis', type: 'text', required: true, section: 'license',
    rules: { minLength: 3, maxLength: 30 } },
  { name: 'vehicleId', label: 'Véhicule assigné', type: 'select', section: 'license' },
];

const driverSections: FormSection[] = [
  { title: 'Identité', fields: ['firstName', 'lastName'] },
  { title: 'Contact', fields: ['email', 'phone'] },
  { title: 'Permis de conduire', fields: ['licenseNumber', 'vehicleId'] },
];

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          <td className={styles.skeletonCell}>
            <div className={styles.shimmer} style={{ width: '60%' }} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={styles.shimmer} style={{ width: '40%' }} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={styles.shimmer} style={{ width: '35%' }} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={styles.shimmer} style={{ width: '50%' }} />
          </td>
          <td className={styles.skeletonCell}>
            <div className={styles.shimmer} style={{ width: '40%' }} />
          </td>
          <td className={styles.skeletonCell} style={{ textAlign: 'right' }}>
            <div className={styles.shimmer} style={{ width: 60, marginLeft: 'auto' }} />
          </td>
        </tr>
      ))}
    </>
  );
}

export default function DriversPage() {
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
      toast(err?.response?.data?.message || 'Erreur', 'error');
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
      toast(editing ? 'Chauffeur modifié' : 'Chauffeur créé');
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || 'Erreur lors de l\'enregistrement', 'error');
    },
  });

  const vehicleOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Aucun véhicule' }];
    for (const v of availableVehicles) {
      opts.push({
        value: v.id,
        label: `${v.licensePlate} — ${v.brand} ${v.model} (${v.fuelType})`,
      });
    }
    return opts;
  }, [availableVehicles]);

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
  const drawerSubtitle = editing ? `Permis : ${editing.licenseNumber} — Assignation du véhicule` : '';
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  return (
    <div className={`page-padding ${styles.pageContainer}`}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={`page-title ${styles.pageTitle}`}>
            Chauffeurs
          </h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0 ? `${meta.total} chauffeur${meta.total > 1 ? 's' : ''} dans votre flotte` : 'Les chauffeurs apparaissent ici après création depuis Utilisateurs (rôle "Chauffeur")'}
          </p>
        </div>
      </div>

      <div className={styles.searchBarContainer}>
        <div style={{
          position: 'relative', flex: 1, maxWidth: 320,
        }}>
          <Search size={14} className={styles.searchIcon} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          }} />
          <input
            placeholder="Rechercher un chauffeur…"
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        {search && (
          <span className={styles.resultCount}>
            {filtered.length} résultat{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {['Nom', 'Email', 'Téléphone', 'Permis', 'Véhicule', 'Statut', ''].map((l) => (
                    <th key={l} className={styles.skeletonTh} style={{
                      textAlign: l === '' ? 'right' : 'left',
                    }}>
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
              <Search size={24} />
            </div>
            <p className={styles.emptyStateTitle}>
            {search ? 'Aucun chauffeur ne correspond à cette recherche' : 'Aucun chauffeur enregistré'}
          </p>
          <p className={styles.emptyStateDesc}>
            {search ? 'Essayez un autre terme' : 'Créez un chauffeur depuis Utilisateurs → Nouvel utilisateur → rôle Chauffeur'}
          </p>
        </div>
        ) : (
          <DataTable
            columns={[
              {
                key: 'name', label: 'Nom',
                render: (r: Driver) => `${r.firstName} ${r.lastName}`,
                sortable: true,
              },
              { key: 'email', label: 'Email', render: (r: Driver) => r.email ?? '-', sortable: true },
              { key: 'phone', label: 'Téléphone', render: (r: Driver) => r.phone ?? '-', sortable: false },
              { key: 'licenseNumber', label: 'Permis', sortable: true },
              {
                key: 'vehicle', label: 'Véhicule',
                render: (r: Driver) => r.vehicle ? `${r.vehicle.licensePlate} — ${r.vehicle.brand} ${r.vehicle.model}` : '-',
              },
              {
                key: 'isActive', label: 'Statut',
                render: (r: Driver) => (
                  <Button variant="ghost" size="sm" icon={r.isActive ? <Power size={14} /> : <PowerOff size={14} />} onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })} title={r.isActive ? 'Désactiver' : 'Activer'} />
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
            submitLabel="Enregistrer"
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
