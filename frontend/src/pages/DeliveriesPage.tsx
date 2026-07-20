import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import type { Delivery } from '../types';

export default function DeliveriesPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [deleting, setDeleting] = useState<Delivery | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', page],
    queryFn: () => api.get(`/deliveries?page=${page}&limit=20`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Livraison supprimée');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => api.post('/deliveries', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Livraison créée');
      setShowForm(false);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const deliveries = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Livraisons</h1>
        <button onClick={() => { setEditing(null); setShowForm(!showForm); }} style={addBtnStyle}>
          + Nouvelle livraison
        </button>
      </div>

      {showForm && (
        <DeliveryForm
          initial={editing}
          onSubmit={(body) => createMutation.mutate(body)}
          onCancel={() => setShowForm(false)}
          saving={createMutation.isPending}
        />
      )}

      <DataTable
        columns={[
          { key: 'title', label: 'Titre' },
          { key: 'status', label: 'Statut', render: (r: Delivery) => <StatusBadge status={r.status} /> },
          { key: 'deliveryAddress', label: 'Adresse' },
          {
            key: 'createdAt', label: 'Date',
            render: (r: Delivery) => new Date(r.createdAt).toLocaleDateString(),
          },
        ]}
        data={deliveries}
        total={meta.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        onDelete={(r) => setDeleting(r)}
        loading={isLoading}
        emptyMessage="Aucune livraison pour le moment."
        keyExtractor={(r) => r.id}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la livraison"
        message={`Supprimer "${deleting?.title}" ? Cette action est réversible.`}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: '#ffc107', assigned: '#17a2b8', in_progress: '#007bff',
    delivered: '#28a745', failed: '#dc3545', cancelled: '#6c757d',
  };
  return (
    <span style={{
      background: colors[status] || '#888', color: '#fff',
      padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
    }}>
      {status.replace('_', ' ')}
    </span>
  );
}

function DeliveryForm({
  initial, onSubmit, onCancel, saving,
}: {
  initial: any; onSubmit: (body: any) => void; onCancel: () => void; saving: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [pickupAddress, setPickupAddress] = useState(initial?.pickupAddress ?? '');
  const [deliveryAddress, setDeliveryAddress] = useState(initial?.deliveryAddress ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ title, pickupAddress, deliveryAddress });
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)}
          style={inputStyle} required />
        <input placeholder="Adresse d'enlèvement" value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)}
          style={inputStyle} required />
        <input placeholder="Adresse de livraison" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)}
          style={inputStyle} required />
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
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.9rem', flex: 1, minWidth: 200,
};
