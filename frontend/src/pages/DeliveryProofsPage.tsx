import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, Search } from 'lucide-react';
import api from '../services/api/client';
import styles from './DeliveryProofsPage.module.css';
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
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[40, 30, 25, 20, 20, 20].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%` }} />
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
    <div className={styles.pageContainer}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.pageTitle}>
            <Package size={22} className={styles.pageTitleIcon} />
            Preuves de livraison
          </h1>
          <p className={styles.pageSubtitle}>
            {meta.total > 0 ? `${meta.total} confirmation${meta.total > 1 ? 's' : ''}` : 'Historique des validations de livraison'}
          </p>
        </div>
      </div>

      <div className={styles.searchRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder="Rechercher..."
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className={styles.statusFilterSelect}
        >
          <option value="">Tous les statuts</option>
          <option value="delivered">Livré</option>
          <option value="failed">Échoué</option>
        </select>
      </div>

      <div className={styles.tableContainer}>
        {isLoading ? (
          <div className={styles.skeletonTableWrapper}>
            <table className={styles.skeletonTable}>
              <thead>
                <tr className={styles.skeletonTheadTr}>
                  {['Livraison', 'Chauffeur', 'Statut', 'Écart', 'Preuve GPS', 'Validé le'].map((l) => (
                    <th key={l} className={styles.skeletonTh}>{l}</th>
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
                  <span className={styles.statusText} style={{ color: STATUS_COLORS[r.status] }}>
                    {STATUS_LABELS[r.status] || r.status}
                  </span>
                ),
              },
              {
                key: 'distance', label: 'Écart',
                render: (r: DeliveryProof) => {
                  if (r.deliveryProofDistance == null && r.locationMismatch) {
                    return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Non vérifiable ⚠️</span>;
                  }
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
