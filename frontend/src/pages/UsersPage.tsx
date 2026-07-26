import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Power, PowerOff } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import type { AppUser, VehicleListItem } from '../types';

interface UserFormValues {
  firstName: string; lastName: string; email: string;
  phone: string; role: string; password: string;
  licenseNumber: string; vehicleId: string;
}

const userFields: FieldDef<UserFormValues>[] = [
  { name: 'firstName', label: 'Prénom', type: 'text', required: true, section: 'identity', autoFocus: true,
    rules: { minLength: 2, maxLength: 50 } },
  { name: 'lastName', label: 'Nom', type: 'text', required: true, section: 'identity',
    rules: { minLength: 2, maxLength: 50 } },
  { name: 'email', label: 'Adresse email', type: 'email', required: true, section: 'contact' },
  { name: 'phone', label: 'Téléphone', type: 'tel', section: 'contact',
    rules: { pattern: /^0[1-9][0-9]{8}$/, patternMessage: 'Le numéro doit commencer par 0 et faire 10 chiffres' } },
  { name: 'role', label: 'Rôle', type: 'select', required: true, section: 'account',
    options: [
      { value: 'admin', label: 'Administrateur' },
      { value: 'dispatcher', label: 'Dispatcher' },
      { value: 'driver', label: 'Chauffeur' },
      { value: 'client', label: 'Client' },
    ] },
  { name: 'password', label: 'Mot de passe', type: 'password', section: 'account',
    rules: { minLength: 12,
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).+$/,
      patternMessage: '12 caractères min, une majuscule, une minuscule, un chiffre, un caractère spécial',
    } },
  { name: 'licenseNumber', label: 'Numéro de permis', type: 'text', required: true, section: 'license',
    rules: { minLength: 3, maxLength: 30 } },
  { name: 'vehicleId', label: 'Véhicule assigné', type: 'select', section: 'license' },
];

const userSectionsTemplate: FormSection[] = [
  { title: 'Identité', fields: ['firstName', 'lastName'] },
  { title: 'Contact', fields: ['email', 'phone'] },
  { title: 'Compte', fields: ['role', 'password'] },
  { title: 'Permis chauffeur', fields: ['licenseNumber', 'vehicleId'] },
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
          {[50, 40, 30, 25, 25].map((w, j) => (
            <td key={j} style={{ padding: 'var(--space-md) var(--space-lg)' }}>
              <div style={{ ...shimmer, width: `${w}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--color-red)',
  dispatcher: 'var(--color-accent)',
  driver: 'var(--color-teal)',
  client: 'var(--color-text-tertiary)',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  dispatcher: 'Dispatcher',
  driver: 'Chauffeur',
  client: 'Client',
};

export default function UsersPage() {
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles', 'list'],
    queryFn: () => api.get('/vehicles/list').then((r) => r.data),
  });
  const allVehicles: VehicleListItem[] = vehiclesData ?? [];
  const availableVehicles = useMemo(() => allVehicles.filter((v) => !v.driver), [allVehicles]);

  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading } = useQuery({
    queryKey: ['users', page],
    queryFn: () => api.get(`/users?page=${page}&limit=20`).then((r) => r.data),
  });

  const users: AppUser[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter((u) =>
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }, [users, search]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

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

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: UserFormValues) => {
      const payload: any = {
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        phone: body.phone || undefined,
      };
      if (!editing || body.password) payload.password = body.password;
      if (body.role === 'driver') {
        if (body.licenseNumber) payload.licenseNumber = body.licenseNumber;
        if (body.vehicleId) payload.vehicleId = body.vehicleId;
      }
      return editing
        ? api.patch(`/users/${editing.id}`, payload)
        : api.post('/users', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
      queryClient.invalidateQueries({ queryKey: ['vehicles', 'list'] });
      const id = editing?.id || '';
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1500);
      toast(editing ? 'Utilisateur modifié' : 'Utilisateur créé');
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur lors de l\'enregistrement', 'error');
    },
  });

  const isEdit = !!editing;

  const vehicleOpts = useMemo(() => {
    const opts = [{ value: '', label: 'Aucun véhicule' }];
    for (const v of availableVehicles) {
      opts.push({
        value: v.id,
        label: `${v.licensePlate} — ${v.brand} ${v.model} (${v.fuelType})`,
      });
    }
    return opts;
  }, [availableVehicles]);

  const userForm = useEntityForm<UserFormValues>({
    initial: editing ? {
      firstName: editing.firstName,
      lastName: editing.lastName,
      email: editing.email,
      phone: editing.phone || '',
      role: editing.role,
      password: '',
    } : { firstName: '', lastName: '', email: '', phone: '', role: 'dispatcher', password: '', licenseNumber: '', vehicleId: '' },
    fields: userFields.map(f => f.name === 'vehicleId' ? { ...f, options: vehicleOpts } : f),
    sections: userSectionsTemplate,
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  const visibleSections = useMemo(() => {
    return userForm.values.role === 'driver'
      ? userSectionsTemplate
      : userSectionsTemplate.filter(s => s.title !== 'Permis chauffeur');
  }, [userForm.values.role]);

  useEffect(() => {
    if (drawerOpen) userForm.reset();
  }, [drawerOpen, editing?.id]);

  const drawerTitle = editing ? `${editing.firstName} ${editing.lastName}` : 'Nouvel utilisateur';
  const drawerSubtitle = editing ? `Rôle : ${ROLE_LABELS[editing.role] || editing.role}` : 'Créez un compte pour un membre de votre équipe';
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  return (
    <div className="page-padding" style={{ padding: 'var(--space-xl)', height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
            Utilisateurs
          </h1>
          <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {meta.total > 0 ? `${meta.total} utilisateur${meta.total > 1 ? 's' : ''}` : 'Gérez les accès à votre plateforme. Créez un chauffeur en sélectionnant le rôle "Chauffeur".'}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          Nouvel utilisateur
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
            placeholder="Rechercher un utilisateur…"
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
                  {['Nom', 'Email', 'Rôle', 'Statut', 'Inscrit le', ''].map((l) => (
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
              {search ? 'Aucun utilisateur ne correspond' : 'Aucun utilisateur enregistré'}
            </p>
            <p style={{
              margin: 0, fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)', textAlign: 'center',
            }}>
              {search ? 'Essayez un autre terme' : 'Invitez les membres de votre équipe'}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                Inviter un utilisateur
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={[
              {
                key: 'name', label: 'Nom', sortable: true,
                render: (r: AppUser) => `${r.firstName} ${r.lastName}`,
              },
              { key: 'email', label: 'Email', sortable: true },
              {
                key: 'role', label: 'Rôle', sortable: true,
                render: (r: AppUser) => (
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    fontFamily: 'var(--font-mono)',
                    background: `${ROLE_COLORS[r.role] || 'var(--color-text-tertiary)'}18`,
                    color: ROLE_COLORS[r.role] || 'var(--color-text-tertiary)',
                  }}>
                    {ROLE_LABELS[r.role] || r.role}
                  </span>
                ),
              },
              {
                key: 'isActive', label: 'Statut',
                render: (r: AppUser) => (
                  <Button variant="ghost" size="sm" icon={r.isActive ? <Power size={14} /> : <PowerOff size={14} />} onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })} title={r.isActive ? 'Désactiver' : 'Activer'} />
                ),
              },
              {
                key: 'createdAt', label: 'Inscrit le', sortable: true,
                render: (r: AppUser) => (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                    {formatDate(r.createdAt)}
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
            loading={userForm.saving}
            onCancel={onCancel}
            submitLabel={isEdit ? 'Enregistrer' : 'Créer l\'utilisateur'}
            error={userForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={userForm.handleSubmit}>
          {visibleSections.map((sec) => (
            <DialogSection key={sec.title} title={sec.title}>
              {sec.fields.map((fieldName) => {
                const def = userFields.find((f) => f.name === fieldName)!;
                if (fieldName === 'password' && isEdit && !userForm.touched.has('password')) {
                  const val = userForm.values.password as string;
                  return (
                    <React.Fragment key={fieldName}>
                      <DialogField label={def.label} error={null}>
                        <input
                          className="dialog-input"
                          type="password"
                          value={val}
                          onChange={(e) => userForm.setValue(fieldName, e.target.value)}
                          onBlur={() => userForm.handleBlur(fieldName)}
                          placeholder="Laisser vide pour conserver l'actuel"
                          autoFocus={def.autoFocus}
                        />
                      </DialogField>
                      <p style={{
                        margin: '-0.75rem 0 var(--space-lg)',
                        fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)',
                      }}>
                        Laissez vide pour conserver le mot de passe actuel
                      </p>
                    </React.Fragment>
                  );
                }
                const val = userForm.values[fieldName as keyof UserFormValues] as string;
                const err = userForm.touched.has(fieldName) ? userForm.errors[fieldName] : null;
                return (
                  <DialogField key={fieldName} label={def.label} error={err} required={def.required}>
                    {def.type === 'select' ? (
                      <select
                        className="dialog-select"
                        value={val}
                        onChange={(e) => userForm.setValue(fieldName as keyof UserFormValues, e.target.value)}
                        onBlur={() => userForm.handleBlur(fieldName as keyof UserFormValues)}
                      >
                        {def.options?.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="dialog-input"
                        type={def.type || 'text'}
                        value={val}
                        onChange={(e) => userForm.setValue(fieldName as keyof UserFormValues, e.target.value)}
                        onBlur={() => userForm.handleBlur(fieldName as keyof UserFormValues)}
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
        title="Supprimer l'utilisateur"
        message={
          deleting
            ? `Supprimer ${deleting.firstName} ${deleting.lastName} (${deleting.email}) ? Cette action est irréversible.`
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
