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
import styles from './FleetPage.module.css';

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
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[40, 30, 20, 35, 25, 25, 20].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%` }} />
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
    <div className={`page-padding ${styles.pageContainer}`}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.pageTitle}>
            Flotte
          </h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0 ? `${meta.total} véhicule${meta.total > 1 ? 's' : ''} dans votre flotte` : 'Gérez vos véhicules'}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          Nouveau véhicule
        </Button>
      </div>

      <div className={styles.searchBarContainer}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} className={styles.searchIcon} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          }} />
          <input
            placeholder="Rechercher un véhicule…"
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {['Marque', 'Modèle', 'Année', 'Plaque', 'Carburant', 'Chauffeur', 'Statut', ''].map((l) => (
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
              {search ? 'Aucun véhicule ne correspond' : 'Aucun véhicule enregistré'}
            </p>
            <p className={styles.emptyStateDesc}>
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
                      <div className={styles.formSelectWrapper}>
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
                            className={styles.addDeviceBtn}
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
            className={styles.modalBackdrop}
          />
          <div className={styles.modalContent}>
            <h3 className={styles.modalTitle}>
              Nouveau dispositif Traccar
            </h3>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                Nom du traceur *
              </label>
              <input
                className="dialog-input"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                placeholder="Ex: Traceur Renault Kangoo"
              />
            </div>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>
                Identifiant unique (IMEI) *
              </label>
              <input
                className="dialog-input"
                value={newDeviceId}
                onChange={(e) => setNewDeviceId(e.target.value)}
                placeholder="Ex: 863295042345678"
              />
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setShowAddDevice(false)}
                className={styles.cancelBtn}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={!newDeviceName.trim() || !newDeviceId.trim() || addDeviceMutation.isPending}
                onClick={() => addDeviceMutation.mutate({ name: newDeviceName.trim(), uniqueId: newDeviceId.trim() })}
                className={styles.submitBtn}
                style={{ opacity: (!newDeviceName.trim() || !newDeviceId.trim()) ? 0.5 : 1 }}
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
