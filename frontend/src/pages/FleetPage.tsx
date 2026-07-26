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
import type { Vehicle } from '../types';

interface VehicleFormValues {
  brand: string; model: string; year: string;
  licensePlate: string; fuelType: string;
  vin: string; theoreticalConsumption: string;
  positionSource: string; traccarDeviceId: string;
}

const vehicleFields: FieldDef<VehicleFormValues>[] = [
  { name: 'brand', label: 'Marque', type: 'text', required: true, section: 'identity', autoFocus: true,
    rules: { minLength: 2, maxLength: 50 } },
  { name: 'model', label: 'Modèle', type: 'text', required: true, section: 'identity',
    rules: { minLength: 1, maxLength: 50 } },
  { name: 'year', label: 'Année', type: 'number', required: true, section: 'identity',
    rules: { minLength: 4, maxLength: 4, pattern: /^\d{4}$/, patternMessage: 'Année invalide (ex: 2024)' } },
  { name: 'licensePlate', label: 'Plaque d\'immatriculation', type: 'text', required: true, section: 'registration',
    rules: { minLength: 4, maxLength: 15 } },
  { name: 'vin', label: 'Numéro VIN', type: 'text', section: 'registration',
    rules: { maxLength: 17 } },
  { name: 'fuelType', label: 'Type de carburant', type: 'select', required: true, section: 'specs',
    options: [
      { value: 'Essence', label: 'Essence' },
      { value: 'Diesel', label: 'Diesel' },
      { value: 'Électrique', label: 'Électrique' },
      { value: 'Hybride', label: 'Hybride Essence' },
      { value: 'Hybride Diesel', label: 'Hybride Diesel' },
      { value: 'GPL', label: 'GPL' },
    ] },
  { name: 'theoreticalConsumption', label: 'Consommation théorique (L/100km)', type: 'number', section: 'specs' },
  { name: 'positionSource', label: 'Source de position', type: 'select', required: true, section: 'gps',
    options: [
      { value: 'phone', label: 'App mobile (chauffeur)' },
      { value: 'physical_tracker', label: 'Traceur physique (Traccar)' },
    ] },
  { name: 'traccarDeviceId', label: 'Dispositif Traccar', type: 'select', section: 'gps' },
];

const vehicleSections: FormSection[] = [
  { title: 'Identité du véhicule', fields: ['brand', 'model', 'year'] },
  { title: 'Immatriculation', fields: ['licensePlate', 'vin'] },
  { title: 'Caractéristiques', fields: ['fuelType', 'theoreticalConsumption'] },
  { title: 'Source GPS', fields: ['positionSource', 'traccarDeviceId'] },
];

function SkeletonRows() {
  const shimmer = {
    height: 14, background: 'var(--color-skeleton)', borderRadius: 4,
    animation: 'dt-shimmer 1.5s infinite linear',
    backgroundImage: 'linear-gradient(90deg, var(--color-skeleton) 25%, rgba(255,255,255,0.05) 50%, var(--color-skeleton) 75%)',
    backgroundSize: '200% 100%',
  };
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          {[40, 30, 20, 35, 25, 25, 20].map((w, j) => (
            <td key={j} style={{ padding: 'var(--space-md) var(--space-lg)' }}>
              <div style={{ ...shimmer, width: `${w}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function FleetPage() {
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
      toast('Véhicule supprimé');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
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
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const addDeviceMutation = useMutation({
    mutationFn: (body: { name: string; uniqueId: string }) =>
      api.post('/vehicles/traccar-devices', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['traccar-devices'] });
      toast('Dispositif Traccar ajouté');
      setShowAddDevice(false);
      setNewDeviceName('');
      setNewDeviceId('');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de l\'ajout', 'error');
    },
  });

  const traccarDeviceOptions = (traccarDevices || []).map((d: any) => ({
    value: String(d.id),
    label: `${d.name} (ID: ${d.id})`,
  }));

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
      const payload: any = {
        brand: body.brand,
        model: body.model,
        year: Number(body.year),
        licensePlate: body.licensePlate,
        fuelType: body.fuelType,
        positionSource: body.positionSource || 'phone',
      };
      if (body.vin) payload.vin = body.vin;
      if (body.theoreticalConsumption) payload.theoreticalConsumption = Number(body.theoreticalConsumption);
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
      toast(editing ? 'Véhicule modifié' : 'Véhicule créé');
      setDrawerOpen(false);
      setEditing(null);
    },
  });

  const vehicleForm = useEntityForm<VehicleFormValues>({
    initial: editing ? {
      brand: editing.brand,
      model: editing.model,
      year: String(editing.year),
      licensePlate: editing.licensePlate,
      fuelType: editing.fuelType,
      vin: '',
      theoreticalConsumption: '',
      positionSource: (editing as any).positionSource || 'phone',
      traccarDeviceId: (editing as any).traccarDeviceId || '',
    } : { brand: '', model: '', year: String(new Date().getFullYear()), licensePlate: '', fuelType: 'Diesel', vin: '', theoreticalConsumption: '', positionSource: 'phone', traccarDeviceId: '' },
    fields: fieldsWithTraccar,
    sections: vehicleSections,
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  useEffect(() => {
    if (drawerOpen) vehicleForm.reset();
  }, [drawerOpen, editing?.id]);

  const drawerTitle = editing ? `${editing.brand} ${editing.model} (${editing.licensePlate})` : 'Nouveau véhicule';
  const drawerSubtitle = editing ? `Année ${editing.year} · ${editing.fuelType}` : 'Ajoutez un véhicule à votre flotte';
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
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700,
            color: 'var(--color-text)', letterSpacing: '-0.02em', margin: 0,
          }}>
            Flotte
          </h1>
          <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {meta.total > 0 ? `${meta.total} véhicule${meta.total > 1 ? 's' : ''} dans votre flotte` : 'Gérez vos véhicules'}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          Nouveau véhicule
        </Button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
        marginBottom: 'var(--space-lg)',
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--color-text-tertiary)', pointerEvents: 'none',
          }} />
          <input
            placeholder="Rechercher un véhicule…"
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
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{
            background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {['Marque', 'Modèle', 'Année', 'Plaque', 'Carburant', 'Chauffeur', 'Statut', ''].map((l) => (
                    <th key={l} style={{
                      padding: 'var(--space-md) var(--space-lg)', fontWeight: 600,
                      fontSize: 'var(--text-xs)', textTransform: 'uppercase',
                      letterSpacing: '0.05em', color: 'var(--color-text-secondary)',
                      textAlign: l === '' ? 'right' : 'left', whiteSpace: 'nowrap',
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
            background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border-subtle)', gap: 'var(--space-md)',
          }}>
            <div style={{
              width: 48, height: 48, borderRadius: 'var(--radius-full)',
              background: 'var(--color-accent-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-accent)', fontSize: 24,
            }}>
              <Plus size={24} />
            </div>
            <p style={{
              margin: 0, fontSize: 'var(--text-md)', fontWeight: 500,
              color: 'var(--color-text-secondary)', textAlign: 'center',
            }}>
              {search ? 'Aucun véhicule ne correspond' : 'Aucun véhicule enregistré'}
            </p>
            <p style={{
              margin: 0, fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)', textAlign: 'center',
            }}>
              {search ? 'Essayez un autre terme' : 'Ajoutez le premier véhicule à votre flotte'}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                Ajouter un véhicule
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'brand', label: 'Marque', sortable: true },
              { key: 'model', label: 'Modèle', sortable: true },
              { key: 'year', label: 'Année', sortable: true },
              { key: 'licensePlate', label: 'Plaque', sortable: true },
              { key: 'fuelType', label: 'Carburant', sortable: true },
              {
                key: 'driver', label: 'Chauffeur',
                render: (r: Vehicle) => r.driver ? `${r.driver.firstName} ${r.driver.lastName}` : '-',
              },
              {
                key: 'isActive', label: 'Statut',
                render: (r: Vehicle) => (
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
            loading={vehicleForm.saving}
            onCancel={onCancel}
            submitLabel={editing ? 'Enregistrer' : 'Créer le véhicule'}
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
                      <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
                        <select
                          className="dialog-select"
                          value={val}
                          onChange={(e) => vehicleForm.setValue(fieldName as keyof VehicleFormValues, e.target.value)}
                          onBlur={() => vehicleForm.handleBlur(fieldName as keyof VehicleFormValues)}
                          style={{ flex: 1 }}
                        >
                          {def.name === 'traccarDeviceId' && (
                            <option value="">Sélectionnez un dispositif…</option>
                          )}
                          {def.options?.map((o: { value: string; label: string }) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {def.name === 'traccarDeviceId' && (
                          <button
                            type="button"
                            onClick={() => setShowAddDevice(true)}
                            title="Ajouter un nouveau dispositif Traccar"
                            style={{
                              padding: 'var(--space-sm) var(--space-md)',
                              border: '1px solid var(--color-input-border)',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--color-surface-alt)',
                              color: 'var(--color-text)',
                              cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 6,
                              fontSize: 'var(--text-xs)',
                              whiteSpace: 'nowrap',
                              flexShrink: 0,
                            }}
                          >
                            <Plus size={14} /> Ajouter
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
        title="Supprimer le véhicule"
        message={
          deleting
            ? `Supprimer ${deleting.brand} ${deleting.model} (${deleting.licensePlate}, ${deleting.year}) ? Cette action est irréversible et retirera le véhicule de l'historique actif.`
            : ''
        }
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />

      {showAddDevice && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 7000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div
            onClick={() => setShowAddDevice(false)}
            style={{ position: 'absolute', inset: 0, background: 'var(--color-overlay)', backdropFilter: 'blur(6px)' }}
          />
          <div style={{
            position: 'relative',
            width: 420, maxWidth: 'calc(100vw - 32px)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-dialog)',
            padding: 'var(--space-xl)',
          }}>
            <h3 style={{ margin: '0 0 var(--space-lg)', fontSize: 'var(--text-md)', fontWeight: 700 }}>
              Nouveau dispositif Traccar
            </h3>
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Nom du traceur *
              </label>
              <input
                className="dialog-input"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                placeholder="Ex: Traceur Renault Kangoo"
              />
            </div>
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-sm)' }}>
                Identifiant unique (IMEI) *
              </label>
              <input
                className="dialog-input"
                value={newDeviceId}
                onChange={(e) => setNewDeviceId(e.target.value)}
                placeholder="Ex: 863295042345678"
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowAddDevice(false)}
                style={{
                  padding: 'var(--space-sm) var(--space-lg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!newDeviceName.trim() || !newDeviceId.trim() || addDeviceMutation.isPending}
                onClick={() => addDeviceMutation.mutate({ name: newDeviceName.trim(), uniqueId: newDeviceId.trim() })}
                style={{
                  padding: 'var(--space-sm) var(--space-lg)',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-accent)',
                  color: 'var(--color-bg)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  opacity: (!newDeviceName.trim() || !newDeviceId.trim()) ? 0.5 : 1,
                }}
              >
                {addDeviceMutation.isPending ? 'Ajout...' : 'Ajouter'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
