import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Power, PowerOff } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import type { Driver, VehicleListItem } from '../types';

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
        <tr key={`sk-${i}`} style={{
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <div style={{ height: 14, width: '60%', background: 'var(--color-skeleton)', borderRadius: 4, animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
          </td>
          <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <div style={{ height: 14, width: '40%', background: 'var(--color-skeleton)', borderRadius: 4, animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
          </td>
          <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <div style={{ height: 14, width: '35%', background: 'var(--color-skeleton)', borderRadius: 4, animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
          </td>
          <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <div style={{ height: 14, width: '50%', background: 'var(--color-skeleton)', borderRadius: 4, animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
          </td>
          <td style={{ padding: 'var(--space-md) var(--space-lg)' }}>
            <div style={{ height: 14, width: '40%', background: 'var(--color-skeleton)', borderRadius: 4, animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
          </td>
          <td style={{ padding: 'var(--space-md) var(--space-lg)', textAlign: 'right' }}>
            <div style={{ height: 14, width: 60, background: 'var(--color-skeleton)', borderRadius: 4, marginLeft: 'auto', animation: 'dt-shimmer 1.5s infinite linear', backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)', backgroundSize: '200% 100%' }} />
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
  const [deleting, setDeleting] = useState<Driver | null>(null);
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
    return editing
      ? allVehicles.filter((v) => !v.driver || v.driver.id === editing.id)
      : allVehicles.filter((v) => !v.driver);
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/drivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      toast('Chauffeur supprimé');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/drivers/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: DriverFormValues) => {
      const payload: any = {
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
    onError: (err: any) => {
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

  const drawerTitle = editing ? `Modifier ${editing.firstName} ${editing.lastName}` : 'Nouveau chauffeur';
  const drawerSubtitle = editing ? `Permis : ${editing.licenseNumber}` : 'Ajoutez un chauffeur à votre flotte';
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  return (
    <div className="page-padding" style={{ padding: 'var(--space-xl)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes dt-row-highlight {
          0% { background: var(--color-accent-muted); }
          100% { background: transparent; }
        }
      `}</style>

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 'var(--space-lg)', flexWrap: 'wrap', gap: 'var(--space-sm)',
      }}>
        <div>
          <h1 className="page-title" style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700,
            color: 'var(--color-text)', letterSpacing: '-0.02em', margin: 0,
          }}>
            Chauffeurs
          </h1>
          <p style={{
            margin: 'var(--space-xs) 0 0',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
          }}>
            {meta.total > 0 ? `${meta.total} chauffeur${meta.total > 1 ? 's' : ''} dans votre flotte` : 'Gérez vos chauffeurs'}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          Nouveau chauffeur
        </Button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
        marginBottom: 'var(--space-lg)',
      }}>
        <div style={{
          position: 'relative', flex: 1, maxWidth: 320,
        }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--color-text-tertiary)', pointerEvents: 'none',
          }} />
          <input
            placeholder="Rechercher un chauffeur…"
            onChange={(e) => handleSearch(e.target.value)}
            style={{
              width: '100%', padding: 'var(--space-sm) var(--space-sm) var(--space-sm) 36px',
              background: 'var(--color-input-bg)',
              border: '1px solid var(--color-input-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-body)',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
        </div>
        {search && (
          <span style={{
            fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}>
            {filtered.length} résultat{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)',
            overflow: 'hidden',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{
                  background: 'var(--color-surface-alt)',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}>
                  {['Nom', 'Email', 'Téléphone', 'Permis', 'Véhicule', 'Statut', ''].map((l) => (
                    <th key={l} style={{
                      padding: 'var(--space-md) var(--space-lg)',
                      fontWeight: 600, fontSize: 'var(--text-xs)',
                      textTransform: 'uppercase', letterSpacing: '0.05em',
                      color: 'var(--color-text-secondary)',
                      textAlign: l === '' ? 'right' : 'left',
                      whiteSpace: 'nowrap',
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
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-4xl)',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)',
            gap: 'var(--space-md)',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-accent)',
              fontSize: 24,
            }}>
              <Plus size={24} />
            </div>
            <p style={{
              margin: 0, fontSize: 'var(--text-md)', fontWeight: 500,
              color: 'var(--color-text-secondary)', textAlign: 'center',
            }}>
              {search ? 'Aucun chauffeur ne correspond à cette recherche' : 'Aucun chauffeur enregistré'}
            </p>
            <p style={{
              margin: 0, fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)', textAlign: 'center',
            }}>
              {search ? 'Essayez un autre terme' : 'Ajoutez le premier chauffeur à votre flotte'}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                Ajouter un chauffeur
              </Button>
            )}
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
        footer={
          <DialogSubmitBar
            form="entity-form"
            loading={driverForm.saving}
            onCancel={onCancel}
            submitLabel={editing ? 'Enregistrer' : 'Créer le chauffeur'}
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
        title="Supprimer le chauffeur"
        message={
          deleting
            ? `Supprimer ${deleting.firstName} ${deleting.lastName} (permis ${deleting.licenseNumber}) ? Cette action est irréversible.`
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
