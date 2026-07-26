import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react';
import api from '../services/api/client';
import DataTable from '../components/DataTable';
import { formatDate } from '../services/i18n/formatDate';

interface DeliveryProof {
  id: string;
  title: string;
  status: string;
  deliveryAddress: string;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryProofLat: number | null;
  deliveryProofLng: number | null;
  deliveryProofDistance: number | null;
  deliveryProofAccuracy: number | null;
  locationMismatch: boolean;
  mismatchResolved: boolean;
  completedAt: string | null;
  scheduledDate: string | null;
  pickupAddress: string;
  driver: { id: string; firstName: string; lastName: string } | null;
  assignedDriver: { id: string; firstName: string; lastName: string } | null;
  vehicle: { id: string; licensePlate: string; brand: string; model: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22c55e',
  failed: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  delivered: 'Livré',
  failed: 'Échoué',
};

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <tr key={`sk-${i}`} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          {[40, 30, 25, 20, 20, 20].map((w, j) => (
            <td key={j} style={{ padding: 'var(--space-md) var(--space-lg)' }}>
              <div style={{ height: 14, width: `${w}%`, background: 'var(--color-skeleton)', borderRadius: 4 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DeliveryProofsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['delivery-proofs', page, statusFilter],
    queryFn: () => api.get(`/deliveries/proofs?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`).then((r) => r.data),
  });

  const proofs: DeliveryProof[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  const filtered = useMemo(() => {
    if (!search.trim()) return proofs;
    const q = search.toLowerCase();
    return proofs.filter((p) =>
      p.title.toLowerCase().includes(q) ||
      p.deliveryAddress.toLowerCase().includes(q) ||
      `${p.driver?.firstName || ''} ${p.driver?.lastName || ''}`.toLowerCase().includes(q) ||
      `${p.assignedDriver?.firstName || ''} ${p.assignedDriver?.lastName || ''}`.toLowerCase().includes(q)
    );
  }, [proofs, search]);

  const driverName = (p: DeliveryProof) => {
    const d = p.driver || p.assignedDriver;
    return d ? `${d.firstName} ${d.lastName}` : '-';
  };

  return (
    <div style={{ padding: 'var(--space-xl)', height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text)', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Package size={22} style={{ color: 'var(--color-accent)' }} />
            Preuves de livraison
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>
            {meta.total > 0 ? `${meta.total} confirmation${meta.total > 1 ? 's' : ''}` : 'Historique des validations de livraison'}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none' }} />
          <input
            placeholder="Rechercher..."
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 8px 8px 36px',
              background: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)',
              borderRadius: 'var(--radius-md)', color: 'var(--color-text)', fontSize: '0.8rem',
              fontFamily: 'var(--font-body)', outline: 'none',
            }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={{
            padding: '8px 12px', background: 'var(--color-input-bg)',
            border: '1px solid var(--color-input-border)', borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)', fontSize: '0.8rem', fontFamily: 'var(--font-body)',
            cursor: 'pointer',
          }}
        >
          <option value="">Tous les statuts</option>
          <option value="delivered">Livré</option>
          <option value="failed">Échoué</option>
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {isLoading ? (
          <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border-subtle)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-alt)', borderBottom: '1px solid var(--color-border-subtle)' }}>
                  {['Livraison', 'Chauffeur', 'Statut', 'Écart', 'Preuve GPS', 'Validé le'].map((l) => (
                    <th key={l} style={{ padding: '10px 14px', fontWeight: 600, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)', textAlign: 'left', whiteSpace: 'nowrap' }}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody><SkeletonRows /></tbody>
            </table>
          </div>
        ) : (
          <DataTable
            columns={[
              { key: 'title', label: 'Livraison', render: (r: DeliveryProof) => r.title, sortable: true },
              { key: 'driver', label: 'Chauffeur', render: (r: DeliveryProof) => driverName(r), sortable: true },
              {
                key: 'status', label: 'Statut', sortable: true,
                render: (r: DeliveryProof) => (
                  <span style={{ color: STATUS_COLORS[r.status], fontWeight: 500 }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                ),
              },
              {
                key: 'distance', label: 'Écart',
                render: (r: DeliveryProof) => {
                  if (r.deliveryProofDistance == null) return '-';
                  const km = (r.deliveryProofDistance / 1000).toFixed(1);
                  return (
                    <span style={{ color: r.locationMismatch ? 'var(--color-red)' : 'var(--color-teal)', fontWeight: r.locationMismatch ? 600 : 400 }}>
                      {km} km{r.locationMismatch ? ' ⚠️' : ' ✓'}
                    </span>
                  );
                },
              },
              {
                key: 'proof', label: 'Preuve GPS',
                render: (r: DeliveryProof) => r.deliveryProofLat ? `${r.deliveryProofLat.toFixed(4)}, ${r.deliveryProofLng?.toFixed(4)}` : '-',
              },
              {
                key: 'completedAt', label: 'Validé le', sortable: true,
                render: (r: DeliveryProof) => r.completedAt ? formatDate(r.completedAt) : '-',
              },
            ]}
            data={filtered}
            total={meta.total}
            page={page}
            limit={20}
            onPageChange={setPage}
            loading={false}
            emptyMessage="Aucune preuve de livraison"
            keyExtractor={(r) => r.id}
          />
        )}
      </div>
    </div>
  );
}
