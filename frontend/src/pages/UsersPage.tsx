import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, Power, PowerOff, UserCog, Users, UserCheck, UserX, Truck,
  ShieldCheck, Shield, Mail, Clock,
} from 'lucide-react';
import Button from '../components/Button';
import Badge, { type BadgeVariant } from '../components/Badge';
import Card from '../components/Card';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef, type FormSection } from '../hooks/useEntityForm';
import { useToast } from '../components/Toast';
import type { AppUser, VehicleListItem } from '../types';
import styles from './UsersPage.module.css';
import { useCountUp } from '../hooks/useCountUp';

type ApiError = { response?: { data?: { message?: string } } };

interface UserFormValues {
  firstName: string; lastName: string; email: string;
  phone: string; role: string; password: string;
  licenseNumber: string; vehicleId: string;
}

const ROLE_COLORS: Record<string, string> = {
  admin: 'var(--color-red)',
  dispatcher: 'var(--color-accent)',
  driver: 'var(--color-teal)',
  client: 'var(--color-text-tertiary)',
};

// Utilisé par le Badge du rôle (RolePill) — mêmes couleurs que ROLE_COLORS
// ci-dessus, exprimées en variantes Badge plutôt qu'en var() CSS brutes.
const ROLE_VARIANT: Record<string, BadgeVariant> = {
  admin: 'red',
  dispatcher: 'accent',
  driver: 'teal',
  client: 'neutral',
};

const ROLE_ICONS: Record<string, React.ReactNode> = {
  admin: <ShieldCheck size={13} />,
  dispatcher: <Shield size={13} />,
  driver: <Truck size={13} />,
  client: <UserX size={13} />,
};

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

function RolePill({ role }: { role: string }) {
  const { t } = useTranslation();
  return (
    <Badge variant={ROLE_VARIANT[role] || 'neutral'} size="sm" icon={ROLE_ICONS[role]}>
      {t(`users.rolesShort.${role}`, { defaultValue: role })}
    </Badge>
  );
}

function UserNameCell({ user }: { user: AppUser }) {
  const initials = `${(user.firstName[0] || '').toUpperCase()}${(user.lastName[0] || '').toUpperCase()}`;
  return (
    <span className={styles.userCell}>
      <span className={styles.userAvatar}>{initials}</span>
      <span className={styles.userText}>
        <span className={styles.userName}>{user.firstName} {user.lastName}</span>
        <span className={styles.userEmail}>{user.email}</span>
      </span>
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[50, 40, 30, 25, 25].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%`, animationDelay: `${(i + j) * 90}ms` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function UsersPage() {
  const { t } = useTranslation();
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
  const [roleFilter, setRoleFilter] = useState('');
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
    let list = users;
    if (roleFilter) list = list.filter((u) => u.role === roleFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, search, roleFilter]);

  const stats = useMemo(() => ({
    total: meta.total ?? 0,
    active: users.filter(u => u.isActive).length,
    inactive: users.filter(u => !u.isActive).length,
    drivers: users.filter(u => u.role === 'driver').length,
  }), [users, meta.total]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast(t('users.toast.deleted'), 'success');
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('users.toast.deleteError'), 'error');
      setDeleting(null);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('common.error'), 'error');
    },
  });

  const saveMutation = useMutation({
    mutationFn: (body: UserFormValues) => {
      const payload: Record<string, unknown> = {
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
      toast(editing ? t('users.toast.updated') : t('users.toast.created'), 'success');
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t('users.toast.saveError'), 'error');
    },
  });

  const isEdit = !!editing;

  const vehicleOpts = useMemo(() => {
    const opts = [{ value: '', label: t('users.noVehicle') }];
    for (const v of availableVehicles) {
      opts.push({
        value: v.id,
        label: `${v.licensePlate} — ${v.brand} ${v.model} (${v.fuelType})`,
      });
    }
    return opts;
  }, [availableVehicles, t]);

  const userFields = useMemo<FieldDef<UserFormValues>[]>(() => [
    { name: 'firstName', label: t('users.fields.firstName'), type: 'text', required: true, section: 'identity', autoFocus: true,
      rules: { minLength: 2, maxLength: 50 } },
    { name: 'lastName', label: t('users.fields.lastName'), type: 'text', required: true, section: 'identity',
      rules: { minLength: 2, maxLength: 50 } },
    { name: 'email', label: t('users.fields.email'), type: 'email', required: true, section: 'contact' },
    { name: 'phone', label: t('users.fields.phone'), type: 'tel', section: 'contact',
      rules: { pattern: /^0[1-9][0-9]{8}$/, patternMessage: t('users.validation.phoneFormat') } },
    { name: 'role', label: t('users.fields.role'), type: 'select', required: true, section: 'account',
      options: [
        { value: 'admin', label: t('users.roles.admin') },
        { value: 'dispatcher', label: t('users.roles.dispatcher') },
        { value: 'driver', label: t('users.roles.driver') },
        { value: 'client', label: t('users.roles.client') },
      ] },
    { name: 'password', label: t('users.fields.password'), type: 'password', section: 'account',
      rules: { minLength: 12,
        pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).+$/,
        patternMessage: t('users.validation.passwordFormat'),
      } },
    { name: 'licenseNumber', label: t('users.fields.licenseNumber'), type: 'text', required: true, section: 'license',
      rules: { minLength: 3, maxLength: 30 } },
    { name: 'vehicleId', label: t('users.fields.vehicleId'), type: 'select', section: 'license' },
  ], [t]);

  const userSectionsTemplate = useMemo<FormSection[]>(() => [
    { title: t('users.formSections.identity'), fields: ['firstName', 'lastName'] },
    { title: t('users.formSections.contact'), fields: ['email', 'phone'] },
    { title: t('users.formSections.account'), fields: ['role', 'password'] },
    { title: t('users.formSections.license'), fields: ['licenseNumber', 'vehicleId'] },
  ], [t]);

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
      : userSectionsTemplate.filter(s => !s.fields.includes('licenseNumber'));
  }, [userForm.values.role, userSectionsTemplate]);

  useEffect(() => {
    if (drawerOpen) userForm.reset();
  }, [drawerOpen, editing?.id]);

  const drawerTitle = editing ? `${editing.firstName} ${editing.lastName}` : t('users.newUser');
  const drawerSubtitle = editing ? t('users.editUser', { role: t(`users.roles.${editing.role}`, { defaultValue: editing.role }) }) : t('users.drawerSubtitle');
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  const roleChips = [
    { value: '', label: t('users.allRoles') },
    { value: 'admin', label: t('users.rolesShort.admin') },
    { value: 'dispatcher', label: t('users.rolesShort.dispatcher') },
    { value: 'driver', label: t('users.rolesShort.driver') },
    { value: 'client', label: t('users.rolesShort.client') },
  ];

  return (
    <div className={styles.pageContainer}>
      {/* @keyframes dt-row-highlight vit dans la feuille globale (src/styles/theme.ts) */}
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><UserCog size={24} /></div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('users.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('users.title')}</h1>
          <p className={styles.pageSubtitle}>{meta.total > 0 ? t('users.count', { count: meta.total }) : t('users.subtitle')}</p>
        </div>
        <Button variant="primary" size="md" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          {t('users.newUser')}
        </Button>
      </header>

      <div className={styles.kpiGrid}>
        <KpiCard icon={<Users size={18} />} label={t('users.kpis.total')} value={stats.total} color="var(--color-accent, #F2A93C)" />
        <KpiCard icon={<UserCheck size={18} />} label={t('users.kpis.active')} value={stats.active} color="var(--color-teal)" />
        <KpiCard icon={<UserX size={18} />} label={t('users.kpis.inactive')} value={stats.inactive} color="var(--color-red)" />
        <KpiCard icon={<Truck size={18} />} label={t('users.kpis.drivers')} value={stats.drivers} color="var(--color-teal, #3FA796)" />
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder={t('users.searchPlaceholder')}
            onChange={(e) => handleSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filterChips}>
          {roleChips.map((chip) => (
            <button
              key={chip.value}
              onClick={() => { setRoleFilter(chip.value); setPage(1); }}
              className={`${styles.filterChip} ${roleFilter === chip.value ? styles.filterChipActive : ''}`}
            >
              {chip.value !== '' && <span className={styles.chipDot} style={{ background: ROLE_COLORS[chip.value] }} />}
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {[t('users.table.name'), t('users.table.email'), t('users.table.role'), t('users.table.status'), t('users.table.registeredDate'), ''].map((l) => (
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
            <p className={styles.emptyTitle}>{search ? t('users.empty.noMatch') : t('users.empty.noData')}</p>
            <p className={styles.emptyDesc}>{search ? t('users.empty.tryDifferent') : t('users.empty.inviteTeam')}</p>
            {!search && (
              <Button variant="primary" size="md" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                {t('users.inviteUser')}
              </Button>
            )}
          </div>
        ) : (
          <Card flush animated >
            <DataTable
              columns={[
                {
                  key: 'name', label: t('users.table.name'), sortable: true,
                  render: (r: AppUser) => <UserNameCell user={r} />,
                },
                {
                  key: 'email', label: t('users.table.email'), sortable: true,
                  render: (r: AppUser) => (
                    <span className={styles.emailCell}><Mail size={12} />{r.email}</span>
                  ),
                },
                {
                  key: 'role', label: t('users.table.role'), sortable: true,
                  render: (r: AppUser) => <RolePill role={r.role} />,
                },
                {
                  key: 'isActive', label: t('users.table.status'),
                  render: (r: AppUser) => (
                    <span className={styles.statusCell}>
                      <Badge variant={r.isActive ? 'teal' : 'neutral'} size="sm" dot>
                        {r.isActive ? t('users.status.active') : t('users.status.inactive')}
                      </Badge>
                      <Button
                        variant={r.isActive ? 'ghost' : 'outline'}
                        size="sm"
                        icon={r.isActive ? <Power size={14} /> : <PowerOff size={14} />}
                        onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                        title={r.isActive ? t('users.status.deactivate') : t('users.status.activate')}
                      />
                    </span>
                  ),
                },
                {
                  key: 'createdAt', label: t('users.table.registeredDate'), sortable: true,
                  render: (r: AppUser) => (
                    <span className={styles.dateCell}><Clock size={11} />{formatDate(r.createdAt)}</span>
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
            loading={userForm.saving}
            onCancel={onCancel}
            submitLabel={isEdit ? t('common.save') || 'Enregistrer' : t('users.createUser')}
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
                          placeholder={t('users.passwordPlaceholder')}
                          autoFocus={def.autoFocus}
                        />
                      </DialogField>
                      <p className={styles.passwordHelp}>{t('users.passwordHelp')}</p>
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
        title={t('users.confirmDelete.title')}
        message={
          deleting
            ? t('users.confirmDelete.message', { firstName: deleting.firstName, lastName: deleting.lastName, email: deleting.email })
            : ''
        }
        variant="danger"
        confirmLabel={t('common.delete') || 'Supprimer'}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}