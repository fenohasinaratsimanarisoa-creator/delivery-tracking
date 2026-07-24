import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ChevronDown, ChevronUp } from 'lucide-react';
import Button from '../components/Button';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import DataTable from '../components/DataTable';
import ConfirmDialog from '../components/ConfirmDialog';
import EntityDialog, { DialogField, DialogSection, DialogSubmitBar } from '../components/EntityDialog';
import { useEntityForm, type FieldDef } from '../hooks/useEntityForm';
import LocationSearchInput from '../components/LocationSearchInput';
import { reverseGeocode } from '../services/geocoding/geocodingService';
import { useToast } from '../components/Toast';
import type { Delivery, Driver } from '../types';

interface DeliveryFormValues {
  title: string;
  description: string;
  status: string;
  pickupAddress: string; deliveryAddress: string;
  pickupLat: string; pickupLng: string; pickupLocationLabel: string;
  deliveryLat: string; deliveryLng: string; deliveryLocationLabel: string;
  driverId: string;
  scheduledDate: string;
  notes: string;
}

const deliveryFields: FieldDef<DeliveryFormValues>[] = [
  { name: 'title', label: 'Titre de la livraison', type: 'text', required: true, section: 'main', autoFocus: true,
    rules: { minLength: 2, maxLength: 200 } },
  { name: 'status', label: 'Statut', type: 'text', section: 'main' },
  { name: 'pickupAddress', label: "Adresse d'enlèvement", type: 'text', required: true, section: 'addresses',
    rules: { minLength: 3 } },
  { name: 'deliveryAddress', label: 'Adresse de livraison', type: 'text', required: true, section: 'addresses',
    rules: { minLength: 3 } },
  { name: 'pickupLat', label: 'Latitude (enlèvement)', type: 'text', section: 'gps' },
  { name: 'pickupLng', label: 'Longitude (enlèvement)', type: 'text', section: 'gps' },
  { name: 'deliveryLat', label: 'Latitude (livraison)', type: 'text', section: 'gps' },
  { name: 'deliveryLng', label: 'Longitude (livraison)', type: 'text', section: 'gps' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', assigned: '#06b6d4', in_progress: '#3b82f6',
  delivered: '#22c55e', failed: '#ef4444', cancelled: '#6b7280',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente', assigned: 'Assigné', in_progress: 'En cours',
  delivered: 'Livré', failed: 'Échoué', cancelled: 'Annulé',
};

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
          {[40, 35, 30, 25, 20].map((w, j) => (
            <td key={j} style={{ padding: 'var(--space-md) var(--space-lg)' }}>
              <div style={{ ...shimmer, width: `${w}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DeliveriesPage() {
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [deleting, setDeleting] = useState<Delivery | null>(null);
  const [_highlightedId, setHighlightedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const { data, isLoading } = useQuery({
    queryKey: ['deliveries', page],
    queryFn: () => api.get(`/deliveries?page=${page}&limit=20`).then((r) => r.data),
  });

  const { data: driversData } = useQuery({
    queryKey: ['drivers', 'active'],
    queryFn: () => api.get('/drivers?page=1&limit=100').then((r) => r.data),
    enabled: drawerOpen,
    staleTime: 30000,
  });

  const deliveries: Delivery[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };
  const drivers: Driver[] = driversData?.data ?? [];

  const recentPlaces = useMemo(() => {
    const seen = new Set<string>();
    return deliveries.flatMap((d) => {
      const places: { label: string; lat: number; lng: number }[] = [];
      if (d.pickupAddress && d.pickupLat && d.pickupLng && !seen.has(d.pickupAddress)) {
        seen.add(d.pickupAddress);
        places.push({ label: d.pickupAddress, lat: d.pickupLat, lng: d.pickupLng });
      }
      if (d.deliveryAddress && d.deliveryLat && d.deliveryLng && !seen.has(d.deliveryAddress)) {
        seen.add(d.deliveryAddress);
        places.push({ label: d.deliveryAddress, lat: d.deliveryLat, lng: d.deliveryLng });
      }
      return places;
    }).slice(0, 5);
  }, [deliveries]);

  const filtered = useMemo(() => {
    if (!search.trim()) return deliveries;
    const q = search.toLowerCase();
    return deliveries.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      d.pickupAddress.toLowerCase().includes(q) ||
      d.deliveryAddress.toLowerCase().includes(q) ||
      d.status.toLowerCase().includes(q)
    );
  }, [deliveries, search]);

  const handleSearch = useCallback((val: string) => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
  }, []);

  const saveMutation = useMutation({
    mutationFn: (body: DeliveryFormValues) => {
      const payload: Record<string, unknown> = {
        title: body.title,
        status: body.status || 'pending',
        pickupAddress: body.pickupAddress,
        deliveryAddress: body.deliveryAddress,
      };
      if (body.description) payload.description = body.description;
      if (body.pickupLat) payload.pickupLat = parseFloat(body.pickupLat);
      if (body.pickupLng) payload.pickupLng = parseFloat(body.pickupLng);
      if (body.pickupLocationLabel) payload.pickupLocationLabel = body.pickupLocationLabel;
      if (body.deliveryLat) payload.deliveryLat = parseFloat(body.deliveryLat);
      if (body.deliveryLng) payload.deliveryLng = parseFloat(body.deliveryLng);
      if (body.deliveryLocationLabel) payload.deliveryLocationLabel = body.deliveryLocationLabel;
      if (body.driverId) payload.driverId = body.driverId;
      if (body.scheduledDate) payload.scheduledDate = body.scheduledDate;
      if (body.notes) payload.notes = body.notes;
      return editing
        ? api.patch(`/deliveries/${editing.id}`, payload)
        : api.post('/deliveries', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      const id = editing?.id || '';
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 1500);
      toast(editing ? 'Livraison modifiée' : 'Livraison créée');
      setDrawerOpen(false);
      setEditing(null);
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || "Erreur lors de l'enregistrement", 'error');
    },
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

  const resolveMismatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/deliveries/${id}/resolve-mismatch`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      toast('Alerte marquée comme traitée');
    },
    onError: (err: any) => {
      toast(err?.response?.data?.message || 'Erreur', 'error');
    },
  });

  const emptyForm: DeliveryFormValues = {
    title: '', description: '', status: 'pending', pickupAddress: '', deliveryAddress: '',
    pickupLat: '', pickupLng: '', pickupLocationLabel: '',
    deliveryLat: '', deliveryLng: '', deliveryLocationLabel: '',
    driverId: '', scheduledDate: '', notes: '',
  };

  const deliveryForm = useEntityForm<DeliveryFormValues>({
    initial: editing ? {
      title: editing.title,
      description: editing.description || '',
      status: editing.status,
      pickupAddress: editing.pickupAddress,
      deliveryAddress: editing.deliveryAddress,
      pickupLat: editing.pickupLat?.toString() || '',
      pickupLng: editing.pickupLng?.toString() || '',
      pickupLocationLabel: editing.pickupLocationLabel || '',
      deliveryLat: editing.deliveryLat?.toString() || '',
      deliveryLng: editing.deliveryLng?.toString() || '',
      deliveryLocationLabel: editing.deliveryLocationLabel || '',
      driverId: editing.driverId || '',
      scheduledDate: editing.scheduledDate?.split('T')[0] || '',
      notes: editing.notes || '',
    } : emptyForm,
    fields: deliveryFields,
    sections: [],
    onSubmit: async (values) => { saveMutation.mutate(values); },
  });

  useEffect(() => {
    if (drawerOpen) { deliveryForm.reset(); setShowAdvanced(false); }
  }, [drawerOpen, editing?.id]);

  const [reverseLoading, setReverseLoading] = useState(false);

  useEffect(() => {
    if (!editing || !drawerOpen) return;
    const doReverse = async () => {
      setReverseLoading(true);
      const updates: Record<string, string> = {};
      if (editing.pickupLat && editing.pickupLng && !editing.pickupLocationLabel) {
        const label = await reverseGeocode(editing.pickupLat, editing.pickupLng);
        if (label) updates.pickupLocationLabel = label;
      }
      if (editing.deliveryLat && editing.deliveryLng && !editing.deliveryLocationLabel) {
        const label = await reverseGeocode(editing.deliveryLat, editing.deliveryLng);
        if (label) updates.deliveryLocationLabel = label;
      }
      for (const [k, v] of Object.entries(updates)) {
        deliveryForm.setValue(k as keyof DeliveryFormValues, v);
      }
      setReverseLoading(false);
    };
    doReverse();
  }, [editing?.id, drawerOpen]);

  const drawerTitle = editing ? editing.title : 'Nouvelle livraison';
  const drawerSubtitle = editing
    ? STATUS_LABELS[editing.status] || editing.status
    : 'Titre, adresses et chauffeur en une seule étape';
  const onCancel = () => { setDrawerOpen(false); setEditing(null); };

  const setLocationField = useCallback((field: 'pickup' | 'delivery', value: { lat: number | null; lng: number | null; label: string }) => {
    const prefix = field;
    deliveryForm.setValue(`${prefix}Lat` as keyof DeliveryFormValues, value.lat !== null ? value.lat.toString() : '');
    deliveryForm.setValue(`${prefix}Lng` as keyof DeliveryFormValues, value.lng !== null ? value.lng.toString() : '');
    deliveryForm.setValue(`${prefix}LocationLabel` as keyof DeliveryFormValues, value.label);
    if (field === 'pickup') {
      deliveryForm.setValue('pickupAddress' as keyof DeliveryFormValues, value.label || '');
    } else {
      deliveryForm.setValue('deliveryAddress' as keyof DeliveryFormValues, value.label || '');
    }
  }, [deliveryForm.setValue]);

  const copyPickupToDelivery = useCallback(() => {
    const pickupLabel = deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress;
    const pickupLat = deliveryForm.values.pickupLat;
    const pickupLng = deliveryForm.values.pickupLng;
    if (pickupLabel) {
      deliveryForm.setValue('deliveryAddress' as keyof DeliveryFormValues, pickupLabel);
      deliveryForm.setValue('deliveryLocationLabel' as keyof DeliveryFormValues, pickupLabel);
      if (pickupLat) deliveryForm.setValue('deliveryLat' as keyof DeliveryFormValues, pickupLat);
      if (pickupLng) deliveryForm.setValue('deliveryLng' as keyof DeliveryFormValues, pickupLng);
    }
  }, [deliveryForm.values, deliveryForm.setValue]);

  const getDriverLabel = (d: Driver) =>
    `${d.firstName} ${d.lastName}${d.phone ? ` — ${d.phone}` : ''}`;

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
            Livraisons
          </h1>
          <p style={{ margin: 'var(--space-xs) 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            {meta.total > 0 ? `${meta.total} livraison${meta.total > 1 ? 's' : ''}` : 'Gérez les livraisons de votre flotte'}
          </p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
          Nouvelle livraison
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
            placeholder="Rechercher une livraison…"
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
                  {['Titre', 'Statut', 'Adresse livraison', 'Chauffeur', 'Date', 'Description', ''].map((l) => (
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
              {search ? 'Aucune livraison ne correspond' : 'Aucune livraison enregistrée'}
            </p>
            <p style={{
              margin: 0, fontSize: 'var(--text-sm)',
              color: 'var(--color-text-tertiary)', textAlign: 'center',
            }}>
              {search ? 'Essayez un autre terme' : 'Créez votre première livraison'}
            </p>
            {!search && (
              <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={() => { setEditing(null); setDrawerOpen(true); }}>
                Nouvelle livraison
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'title', label: 'Titre', sortable: true },
              {
                key: 'status', label: 'Statut', sortable: true,
                render: (r: Delivery) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 500,
                      fontFamily: 'var(--font-mono)',
                      background: `${STATUS_COLORS[r.status] || '#6b7280'}20`,
                      color: STATUS_COLORS[r.status] || '#6b7280',
                    }}>
                      {STATUS_LABELS[r.status] || r.status}
                    </span>
                    {r.locationMismatch && !r.mismatchResolved && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: 'var(--radius-sm, 4px)',
                        padding: '4px 8px',
                        fontSize: 'var(--text-xs, 0.625rem)',
                        color: '#ef4444',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                      }}>
                        <span style={{ fontSize: '0.75rem' }}>⚠️</span>
                        <span>{r.deliveryProofDistance != null ? `${r.deliveryProofDistance}m d'écart` : 'Écart détecté'}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); resolveMismatchMutation.mutate(r.id); }}
                          disabled={resolveMismatchMutation.isPending}
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            borderRadius: '3px',
                            padding: '1px 6px',
                            fontSize: '0.6rem',
                            fontFamily: 'var(--font-body)',
                          }}
                        >
                          ✓ Traité
                        </button>
                      </div>
                    )}
                  </div>
                ),
              },
              { key: 'deliveryAddress', label: 'Adresse de livraison' },
              {
                key: 'driver', label: 'Chauffeur',
                render: (r: Delivery) => (
                  r.driver
                    ? `${r.driver.firstName} ${r.driver.lastName}`
                    : <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>Non assigné</span>
                ),
              },
              {
                key: 'createdAt', label: 'Date', sortable: true,
                render: (r: Delivery) => (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                      {formatDate(r.createdAt)}
                    </div>
                    {r.scheduledDate && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent, #F2A93C)', marginTop: 2 }}>
                        📅 {formatDate(r.scheduledDate)}
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'description', label: 'Description',
                render: (r: Delivery) => (
                  <span style={{
                    fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary, #9BA6B9)',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', maxWidth: 200,
                  }}>
                    {r.description || (r.notes
                      ? <span style={{ fontStyle: 'italic' }}>📝 {r.notes.slice(0, 60)}</span>
                      : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    )}
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
        width={640}
        footer={
          <DialogSubmitBar
            form="entity-form"
            loading={deliveryForm.saving}
            onCancel={onCancel}
            submitLabel={editing ? 'Enregistrer' : 'Créer la livraison'}
            error={deliveryForm.serverError}
          />
        }
      >
        <form id="entity-form" onSubmit={deliveryForm.handleSubmit}>
          {/* === SECTION 1: Infos principales === */}
          <DialogSection title="Informations principales">
            <DialogField label="Titre de la livraison" required
              error={deliveryForm.touched.has('title') ? deliveryForm.errors.title : null}>
              <input className="dialog-input" type="text"
                value={deliveryForm.values.title}
                onChange={(e) => deliveryForm.setValue('title', e.target.value)}
                onBlur={() => deliveryForm.handleBlur('title')}
                placeholder="Ex: Livraison Analamanga 45"
                autoFocus />
            </DialogField>

            <DialogField label="Chauffeur"
              error={deliveryForm.touched.has('driverId') ? deliveryForm.errors.driverId : null}>
              <div>
                <select className="dialog-select"
                  value={deliveryForm.values.driverId}
                  onChange={(e) => deliveryForm.setValue('driverId', e.target.value)}
                  onBlur={() => deliveryForm.handleBlur('driverId')}>
                  <option value="">Sélectionner un chauffeur…</option>
                  {drivers.filter((d) => d.isActive).map((d) => (
                    <option key={d.id} value={d.id}>{getDriverLabel(d)}</option>
                  ))}
                </select>
                {drivers.filter((d) => d.isActive).length === 0 && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                    Aucun chauffeur actif disponible
                  </div>
                )}
              </div>
            </DialogField>
          </DialogSection>

          {/* === SECTION 2: Adresses === */}
          <DialogSection title="Adresses">
            <DialogField label="Point d'enlèvement" required
              error={deliveryForm.touched.has('pickupLat') ? deliveryForm.errors.pickupLat : null}>
              <LocationSearchInput
                placeholder="Ex: Analakely Antananarivo…"
                value={{
                  lat: deliveryForm.values.pickupLat ? parseFloat(deliveryForm.values.pickupLat) : null,
                  lng: deliveryForm.values.pickupLng ? parseFloat(deliveryForm.values.pickupLng) : null,
                  label: deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress,
                }}
                onChange={(v) => setLocationField('pickup', v)}
                onBlur={() => {
                  deliveryForm.handleBlur('pickupLat');
                  deliveryForm.handleBlur('pickupLng');
                }}
                recentPlaces={recentPlaces}
              />
            </DialogField>

            <DialogField label="Point de livraison" required
              error={deliveryForm.touched.has('deliveryLat') ? deliveryForm.errors.deliveryLat : null}>
              <LocationSearchInput
                placeholder="Ex: Ivato Antananarivo…"
                value={{
                  lat: deliveryForm.values.deliveryLat ? parseFloat(deliveryForm.values.deliveryLat) : null,
                  lng: deliveryForm.values.deliveryLng ? parseFloat(deliveryForm.values.deliveryLng) : null,
                  label: deliveryForm.values.deliveryLocationLabel || deliveryForm.values.deliveryAddress,
                }}
                onChange={(v) => setLocationField('delivery', v)}
                onBlur={() => {
                  deliveryForm.handleBlur('deliveryLat');
                  deliveryForm.handleBlur('deliveryLng');
                }}
                recentPlaces={recentPlaces}
                showCopyButton={!!(deliveryForm.values.pickupLocationLabel || deliveryForm.values.pickupAddress)}
                onCopyFromOther={copyPickupToDelivery}
                copyTooltip="Même adresse que l'enlèvement"
              />
            </DialogField>
          </DialogSection>

          {/* === SECTION 3: Options avancées (repliables) === */}
          <div style={{ marginBottom: 'var(--space-xl)' }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: 'var(--space-sm) 0',
                border: 'none', background: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--color-text-tertiary)',
                fontFamily: 'var(--font-body)',
              }}
            >
              {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showAdvanced ? 'Masquer les options avancées' : 'Options avancées'}
            </button>

            {showAdvanced && (
              <div style={{
                marginTop: 'var(--space-md)',
                padding: 'var(--space-lg)',
                background: 'var(--color-surface-alt)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                  <DialogField label="Date planifiée">
                    <input className="dialog-input" type="date"
                      value={deliveryForm.values.scheduledDate}
                      onChange={(e) => deliveryForm.setValue('scheduledDate', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('scheduledDate')} />
                  </DialogField>

                  <DialogField label="Statut">
                    <select className="dialog-select"
                      value={deliveryForm.values.status}
                      onChange={(e) => deliveryForm.setValue('status', e.target.value)}
                      onBlur={() => deliveryForm.handleBlur('status')}>
                      <option value="pending">En attente</option>
                      <option value="assigned">Assigné</option>
                      <option value="in_progress">En cours</option>
                      <option value="delivered">Livré</option>
                      <option value="failed">Échoué</option>
                      <option value="cancelled">Annulé</option>
                    </select>
                  </DialogField>
                </div>

                <DialogField label="Description">
                  <textarea className="dialog-input"
                    value={deliveryForm.values.description}
                    onChange={(e) => deliveryForm.setValue('description', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('description')}
                    placeholder="Description détaillée de la livraison…"
                    rows={2}
                    style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }} />
                </DialogField>

                <DialogField label="Notes / Instructions chauffeur">
                  <textarea className="dialog-input"
                    value={deliveryForm.values.notes}
                    onChange={(e) => deliveryForm.setValue('notes', e.target.value)}
                    onBlur={() => deliveryForm.handleBlur('notes')}
                    placeholder="Instructions particulières, informations complémentaires…"
                    rows={3}
                    style={{ resize: 'vertical', fontFamily: 'var(--font-body)' }} />
                </DialogField>
              </div>
            )}
          </div>
        </form>
      </EntityDialog>

      {reverseLoading && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16,
          padding: '8px 16px', background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-md)', fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 99999,
        }}>
          Recherche des adresses…
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Supprimer la livraison"
        message={
          deleting
            ? `Supprimer "${deleting.title}" ? Cette action est irréversible.`
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
