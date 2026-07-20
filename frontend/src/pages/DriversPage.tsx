import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  licenseNumber: string;
  isActive: boolean;
}

export default function DriversPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState<Driver | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['drivers', page],
    queryFn: () => api.get(`/drivers?page=${page}&limit=20`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/drivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast('Chauffeur supprimé');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) =>
      editing ? api.patch(`/drivers/${editing.id}`, body) : api.post('/drivers', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast(editing ? 'Chauffeur modifié' : 'Chauffeur créé');
      setShowForm(false);
      setEditing(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const drivers: Driver[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Chauffeurs</h1>
        <button onClick={() => { setEditing(null); setShowForm(!showForm); }} style={addBtnStyle}>
          + Nouveau chauffeur
        </button>
      </div>

      {showForm && (
        <DriverForm
          initial={editing}
          onSubmit={(body) => saveMutation.mutate(body)}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          saving={saveMutation.isPending}
        />
      )}

      <DataTable
        columns={[
          {
            key: 'name', label: 'Nom',
            render: (r: Driver) => `${r.firstName} ${r.lastName}`,
          },
          { key: 'email', label: 'Email', render: (r: Driver) => r.email ?? '-' },
          { key: 'phone', label: 'Téléphone', render: (r: Driver) => r.phone ?? '-' },
          { key: 'licenseNumber', label: 'Permis' },
          {
            key: 'isActive', label: 'Actif',
            render: (r: Driver) => (
              <span style={{
                background: r.isActive ? '#28a745' : '#6c757d',
                color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
              }}>
                {r.isActive ? 'Oui' : 'Non'}
              </span>
            ),
          },
        ]}
        data={drivers}
        total={meta.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        onEdit={(r) => { setEditing(r); setShowForm(true); }}
        onDelete={(r) => setDeleting(r)}
        loading={isLoading}
        emptyMessage="Aucun chauffeur pour le moment."
        keyExtractor={(r) => r.id}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer le chauffeur"
        message={`Supprimer ${deleting?.firstName} ${deleting?.lastName} ?`}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function DriverForm({
  initial, onSubmit, onCancel, saving,
}: {
  initial: any; onSubmit: (body: any) => void; onCancel: () => void; saving: boolean;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [licenseNumber, setLicenseNumber] = useState(initial?.licenseNumber ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ firstName, lastName, email, phone, licenseNumber });
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} required />
        <input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} required />
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
        <input placeholder="Numéro de permis" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} style={inputStyle} required />
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
