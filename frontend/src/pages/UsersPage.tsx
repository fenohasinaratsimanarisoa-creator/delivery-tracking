import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

interface AppUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => api.get(`/users?page=${page}&limit=20`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast('Utilisateur supprimé');
      setDeleting(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de la suppression', 'error');
      setDeleting(null);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: any) =>
      editing ? api.patch(`/users/${editing.id}`, body) : api.post('/users', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast(editing ? 'Utilisateur modifié' : 'Utilisateur créé');
      setShowForm(false);
      setEditing(null);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message;
      toast(Array.isArray(msg) ? msg[0] : (msg || 'Erreur'), 'error');
    },
  });

  const users: AppUser[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Utilisateurs</h1>
        <button onClick={() => { setEditing(null); setShowForm(!showForm); }} style={addBtnStyle}>
          + Nouvel utilisateur
        </button>
      </div>

      {showForm && (
        <UserForm
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
            render: (r: AppUser) => `${r.firstName} ${r.lastName}`,
          },
          { key: 'email', label: 'Email' },
          {
            key: 'role', label: 'Rôle',
            render: (r: AppUser) => (
              <span style={{
                background: r.role === 'admin' ? '#dc3545' : r.role === 'dispatcher' ? '#17a2b8' : '#6c757d',
                color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
              }}>
                {r.role}
              </span>
            ),
          },
          {
            key: 'isActive', label: 'Actif',
            render: (r: AppUser) => (
              <span style={{
                background: r.isActive ? '#28a745' : '#dc3545',
                color: '#fff', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem',
              }}>
                {r.isActive ? 'Oui' : 'Non'}
              </span>
            ),
          },
          {
            key: 'createdAt', label: 'Créé le',
            render: (r: AppUser) => new Date(r.createdAt).toLocaleDateString(),
          },
        ]}
        data={users}
        total={meta.total}
        page={page}
        limit={20}
        onPageChange={setPage}
        onEdit={(r) => { setEditing(r); setShowForm(true); }}
        onDelete={(r) => setDeleting(r)}
        loading={isLoading}
        emptyMessage="Aucun utilisateur pour le moment."
        keyExtractor={(r) => r.id}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer l'utilisateur"
        message={`Supprimer ${deleting?.firstName} ${deleting?.lastName} ?`}
        variant="danger"
        confirmLabel="Supprimer"
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function UserForm({
  initial, onSubmit, onCancel, saving,
}: {
  initial: any; onSubmit: (body: any) => void; onCancel: () => void; saving: boolean;
}) {
  const [email, setEmail] = useState(initial?.email ?? '');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [role, setRole] = useState(initial?.role ?? 'dispatcher');
  const [phone, setPhone] = useState(initial?.phone ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { email, firstName, lastName, role, phone };
    if (!initial || password) body.password = password;
    onSubmit(body);
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: '#f9f9f9', padding: 16, borderRadius: 8, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} required />
        <input placeholder={initial ? 'Nouveau mot de passe (laisser vide)' : 'Mot de passe'} type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} style={inputStyle} required={!initial} />
        <input placeholder="Prénom" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} required />
        <input placeholder="Nom" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} required />
        <input placeholder="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
          <option value="admin">Admin</option>
          <option value="dispatcher">Dispatcher</option>
          <option value="driver">Chauffeur</option>
          <option value="client">Client</option>
        </select>
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
  padding: '8px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.9rem', flex: 1, minWidth: 150, boxSizing: 'border-box' as const,
};
