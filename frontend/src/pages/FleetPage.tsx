import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import type { Vehicle } from '../types';

export default function FleetPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', page],
    queryFn: () => api.get(`/vehicles?page=${page}&limit=20`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast('Véhicule supprimé');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) =>
      editing ? api.patch(`/vehicles/${editing.id}`, body) : api.post('/vehicles', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
      toast(editing ? 'Véhicule modifié' : 'Véhicule créé');
      setShowForm(false);
      setEditing(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const vehicles: Vehicle[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Flotte</h1>
        <button onClick={() => { setEditing(null); setShowForm(!showForm); }} style={addBtnStyle}>
          + Nouveau véhicule
        </button>
      </div>

      {showForm && (
        <VehicleForm
          initial={editing}
          onSubmit={(body) => saveMutation.mutate(body)}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          saving={saveMutation.isPending}
        />
      )}

      <DataTable
        columns={[
          { key: 'brand', label: 'Marque' },
          { key: 'model', label: 'Modèle' },
          { key: 'year', label: 'Année' },
          { key: 'licensePlate', label: 'Plaque' },
          { key: 'fuelType', label: 'Carburant' },
          {
            key: 'isActive', label: 'Actif',
            render: (r: Vehicle) => (
              <span style={{
                background: r.isActive ? '#28a745' : '#6c757d',
                color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
              }}>
                {r.isActive ? 'Oui' : 'Non'}
              </span>
            ),
          },
        ]}
        data={vehicles}
        total={meta.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        onEdit={(r) => { setEditing(r); setShowForm(true); }}
        onDelete={(r) => setDeleting(r)}
        loading={isLoading}
        emptyMessage="Aucun véhicule pour le moment."
        keyExtractor={(r) => r.id}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le véhicule"
        message={`Supprimer ${deleting?.brand} ${deleting?.model} (${deleting?.licensePlate}) ?`}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function VehicleForm({
  initial, onSubmit, onCancel, saving,
}: {
  initial: any; onSubmit: (body: any) => void; onCancel: () => void; saving: boolean;
}) {
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [year, setYear] = useState(initial?.year ?? 2024);
  const [licensePlate, setLicensePlate] = useState(initial?.licensePlate ?? '');
  const [fuelType, setFuelType] = useState(initial?.fuelType ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ brand, model, year: Number(year), licensePlate, fuelType });
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Marque" value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle} required />
        <input placeholder="Modèle" value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle} required />
        <input placeholder="Année" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ ...inputStyle, width: 100 }} required />
        <input placeholder="Plaque" value={licensePlate} onChange={(e) => setLicensePlate(e.target.value)} style={inputStyle} required />
        <input placeholder="Carburant" value={fuelType} onChange={(e) => setFuelType(e.target.value)} style={inputStyle} required />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={saving} style={{ ...addBtnStyle, background: '#28a745' }}>
          {saving ? 'Enregistrement...' : (initial ? 'Modifier' : 'Créer')}
        </button>
        <button type="button" onClick={onCancel} style={{ ...addBtnStyle, background: '#6c757d' }}>Annuler</button>
      </div>
    </form>
  );
}

const addBtnStyle: React.CSSProperties = {
  padding: '8px 16px', background: '#007bff', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
};
const inputStyle: React.CSSProperties = {
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.9rem', flex: 1, minWidth: 150,
};
