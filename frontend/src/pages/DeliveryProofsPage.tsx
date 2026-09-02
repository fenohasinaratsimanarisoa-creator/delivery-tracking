import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Package, Search, MapPin, Crosshair, CheckCircle2, XCircle, ArrowUpRight,
  ShieldCheck, FileCheck2, Clock,
} from 'lucide-react';
import api from '../services/api/client';
import styles from './DeliveryProofsPage.module.css';
import DataTable from '../components/DataTable';
import { formatDate } from '../services/i18n/formatDate';
import { useTranslation } from 'react-i18next';
import { useCountUp } from '../hooks/useCountUp';

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

const STATUS_DOT_COLORS: Record<string, string> = {
  delivered: 'var(--color-teal)',
  failed: 'var(--color-red)',
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

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const isDelivered = status === 'delivered';
  return (
    <span className={`${styles.statusPill} ${isDelivered ? styles.statusPillOk : styles.statusPillBad}`}>
      <span className={styles.statusPillDot} style={{ background: STATUS_DOT_COLORS[status] }} />
      {isDelivered ? t('deliveryProofsPage.delivered') : t('deliveryProofsPage.failed')}
    </span>
  );
}

function DistanceCell({ p }: { p: DeliveryProof }) {
  const { t } = useTranslation();
  if (p.deliveryProofDistance == null) return <span className={styles.dimText}>{t('deliveryProofsPage.missing')}</span>;
  const km = (p.deliveryProofDistance / 1000).toFixed(1);
  const mismatch = p.locationMismatch && !p.mismatchResolved;
  return (
    <span className={`${styles.distanceBadge} ${mismatch ? styles.distanceBadgeBad : styles.distanceBadgeOk}`}>
      {mismatch ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
      {km} km
      <span className={styles.distanceHint}>{mismatch ? t('deliveryProofsPage.distance.mismatch') : t('deliveryProofsPage.distance.ok')}</span>
    </span>
  );
}

function GpsCell({ p }: { p: DeliveryProof }) {
  const { t } = useTranslation();
  if (!p.deliveryProofLat) return <span className={styles.dimText}>{t('deliveryProofsPage.noProof')}</span>;
  return (
    <span className={styles.gpsCode}>
      <Crosshair size={12} />
      {p.deliveryProofLat.toFixed(4)}, {p.deliveryProofLng?.toFixed(4)}
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <tr key={`sk-${i}`} className={styles.skeletonRow}>
          {[40, 30, 25, 20, 20, 20].map((w, j) => (
            <td key={j} className={styles.skeletonCell}>
              <div className={styles.shimmer} style={{ width: `${w}%`, animationDelay: `${(i + j) * 90}ms` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function DeliveryProofsPage() {
  const { t } = useTranslation();
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

  const stats = useMemo(() => ({
    total: meta.total ?? 0,
    delivered: proofs.filter(p => p.status === 'delivered').length,
    failed: proofs.filter(p => p.status === 'failed').length,
    mismatch: proofs.filter(p => p.locationMismatch && !p.mismatchResolved).length,
  }), [proofs, meta.total]);

  const driverInitials = (p: DeliveryProof) => {
    const d = p.driver || p.assignedDriver;
    if (!d) return '?';
    return `${(d.firstName[0] || '').toUpperCase()}${(d.lastName[0] || '').toUpperCase()}`;
  };

  return (
    <div className={styles.pageContainer}>
      <header className={styles.pageHeader}>
        <div className={styles.titleIconChip}><FileCheck2 size={24} /></div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t('deliveryProofsPage.kicker')}</span>
          <h1 className={styles.pageTitle}>{t('deliveryProofsPage.title')}</h1>
          <p className={styles.pageSubtitle}>{t('deliveryProofsPage.subtitle')}</p>
        </div>
        <div className={styles.verifiedPill}>
          <ShieldCheck size={14} />
          {t('deliveryProofsPage.verified')}
        </div>
      </header>

      <div className={styles.kpiGrid}>
        <KpiCard icon={<FileCheck2 size={18} />} label={t('deliveryProofsPage.kpis.total')} value={stats.total} color="var(--color-accent, #F2A93C)" />
        <KpiCard icon={<CheckCircle2 size={18} />} label={t('deliveryProofsPage.kpis.delivered')} value={stats.delivered} color="var(--color-teal)" />
        <KpiCard icon={<XCircle size={18} />} label={t('deliveryProofsPage.kpis.failed')} value={stats.failed} color="var(--color-red)" />
        <KpiCard icon={<MapPin size={18} />} label={t('deliveryProofsPage.kpis.mismatch')} value={stats.mismatch} color="var(--color-blue, #4A90E2)" />
      </div>

      <div className={styles.filtersRow}>
        <div className={styles.searchInputWrapper}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder={t('deliveryProofsPage.searchPlaceholder')}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filterChips}>
          {[
            { value: '', label: t('deliveryProofsPage.allStatuses') },
            { value: 'delivered', label: t('deliveryProofsPage.delivered') },
            { value: 'failed', label: t('deliveryProofsPage.failed') },
          ].map((chip) => (
            <button
              key={chip.value}
              onClick={() => { setStatusFilter(chip.value); setPage(1); }}
              className={`${styles.filterChip} ${statusFilter === chip.value ? styles.filterChipActive : ''}`}
            >
              {chip.value === 'delivered' && <span className={styles.chipDot} style={{ background: 'var(--color-teal)' }} />}
              {chip.value === 'failed' && <span className={styles.chipDot} style={{ background: 'var(--color-red)' }} />}
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
                  {[t('deliveryProofsPage.table.delivery'), t('deliveryProofsPage.table.driver'), t('deliveryProofsPage.table.status'), t('deliveryProofsPage.table.distance'), t('deliveryProofsPage.table.proof'), t('deliveryProofsPage.table.date')].map((l) => (
                    <th key={l} className={styles.skeletonTh}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody><SkeletonRows /></tbody>
            </table>
          </div>
        ) : (
          <div className={styles.tableCard}>
            <DataTable
              columns={[
                {
                  key: 'title', label: t('deliveryProofsPage.table.delivery'), sortable: true,
                  render: (r: DeliveryProof) => (
                    <span className={styles.deliveryCell}>
                      <span className={styles.deliveryIcon}><Package size={14} /></span>
                      <span className={styles.deliveryText}>
                        <Link to={`/deliveries/${r.id}`} className={styles.deliveryLink}>{r.title}</Link>
                        <span className={styles.deliveryAddr}>{r.deliveryAddress}</span>
                      </span>
                      <ArrowUpRight size={13} className={styles.deliveryArrow} />
                    </span>
                  ),
                },
                {
                  key: 'driver', label: t('deliveryProofsPage.table.driver'), sortable: true,
                  render: (r: DeliveryProof) => (
                    <span className={styles.driverCell}>
                      <span className={styles.driverAvatar}>{driverInitials(r)}</span>
                      {driverName(r)}
                    </span>
                  ),
                },
                {
                  key: 'status', label: t('deliveryProofsPage.table.status'), sortable: true,
                  render: (r: DeliveryProof) => <StatusPill status={r.status} />,
                },
                {
                  key: 'distance', label: t('deliveryProofsPage.table.distance'),
                  render: (r: DeliveryProof) => <DistanceCell p={r} />,
                },
                {
                  key: 'proof', label: t('deliveryProofsPage.table.proof'),
                  render: (r: DeliveryProof) => <GpsCell p={r} />,
                },
                {
                  key: 'completedAt', label: t('deliveryProofsPage.table.date'), sortable: true,
                  render: (r: DeliveryProof) => r.completedAt ? <span className={styles.dateCell}><Clock size={12} />{formatDate(r.completedAt)}</span> : <span className={styles.dimText}>—</span>,
                },
              ]}
              data={filtered}
              total={meta.total}
              page={page}
              limit={20}
              onPageChange={setPage}
              loading={false}
              emptyMessage={t('deliveryProofsPage.empty')}
              keyExtractor={(r) => r.id}
            />
          </div>
        )}
      </div>
    </div>
  );
}