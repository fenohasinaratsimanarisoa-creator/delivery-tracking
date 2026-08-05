import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MapPin,
  Flag,
  CalendarDays,
  Truck,
  StickyNote,
  Clock,
  PackagePlus,
  PackageCheck,
  XCircle,
  Inbox,
} from 'lucide-react';
import { formatDate, formatDateShort } from '../services/i18n/formatDate';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import Button from '../components/Button';
import { useDataUpdates } from '../hooks/useDataUpdates';
import type { Delivery } from '../types';
import styles from './MyDeliveriesPage.module.css';

function captureGpsPosition(): Promise<{ latitude: number; longitude: number; accuracy?: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        reject(new Error(err.message || 'Geolocation failed'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

export default function MyDeliveriesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [gpsLoading, setGpsLoading] = useState(false);

  // Rafraîchissement temps réel : quand une nouvelle livraison est assignée, le
  // backend émet dataUpdate(entity='delivery') → ce hook invalide la query et la
  // livraison arrive en première position.
  useDataUpdates();

  const { data, isLoading } = useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => api.get('/deliveries/my-deliveries').then((r) => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status, latitude, longitude, accuracy }: { id: string; status: string; latitude?: number; longitude?: number; accuracy?: number }) =>
      api.patch(`/deliveries/${id}/driver-status`, { status, latitude, longitude, accuracy }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
      toast(t('myDeliveries.toast.statusUpdated'));
      setGpsLoading(false);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      toast(err?.response?.data?.message || t('myDeliveries.toast.updateError'), 'error');
      setGpsLoading(false);
    },
  });

  const handleStatusUpdate = async (id: string, status: string) => {
    if (status === 'delivered' || status === 'failed') {
      setGpsLoading(true);
      try {
        const gps = await captureGpsPosition();
        updateMutation.mutate({ id, status, ...gps });
      } catch {
        toast(t('myDeliveries.toast.gpsRequired'), 'error');
        setGpsLoading(false);
      }
    } else {
      updateMutation.mutate({ id, status });
    }
  };

  const deliveries: Delivery[] = data?.data ?? [];

  // Chaque livraison qui entre passe EN PREMIÈRE PLACE : tri par createdAt desc
  // (le backend renvoie déjà ce tri, on le garantit ici côté client aussi).
  const sorted = [...deliveries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const toTakeCount = sorted.filter((d) => d.status === 'assigned').length;
  const activeCount = sorted.filter((d) => d.status === 'in_progress').length;
  const doneCount = sorted.filter((d) => d.status === 'delivered' || d.status === 'failed').length;

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.headerTitleWrap}>
            <h1 className={styles.pageTitle}>{t('myDeliveries.title')}</h1>
          </div>
        </div>
        <div className={styles.summaryRow}>
          <div className={`${styles.skeletonCard}`} style={{ minHeight: 84 }} />
          <div className={`${styles.skeletonCard}`} style={{ minHeight: 84 }} />
          <div className={`${styles.skeletonCard}`} style={{ minHeight: 84 }} />
        </div>
        <div className={styles.list}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonCard} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.headerTitleWrap}>
          <h1 className={styles.pageTitle}>{t('myDeliveries.title')}</h1>
          <p className={styles.pageSubtitle}>{t('myDeliveries.subtitle')}</p>
        </div>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          {t('myDeliveries.title')}
        </span>
      </div>

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('myDeliveries.summary.toTake')}</span>
          <span className={`${styles.summaryValue} ${styles.summaryValueAccent}`}>{toTakeCount}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('myDeliveries.summary.inProgress')}</span>
          <span className={styles.summaryValue}>{activeCount}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{t('myDeliveries.summary.done')}</span>
          <span className={`${styles.summaryValue} ${styles.summaryValueTeal}`}>{doneCount}</span>
        </div>
      </div>

      {sorted.length === 0 && (
        <div className={styles.emptyState}>
          <span className={styles.emptyIcon}><Inbox size={26} /></span>
          <p className={styles.emptyTitle}>{t('myDeliveries.title')}</p>
          <p className={styles.emptyText}>{t('myDeliveries.empty')}</p>
        </div>
      )}

      <div className={styles.list}>
        {sorted.map((d) => {
          const isActive = d.status === 'in_progress';
          const isPending = d.status === 'assigned';
          return (
            <div
              key={d.id}
              className={`${styles.deliveryCard} ${isActive ? styles.deliveryCardActive : ''}`}
            >
              {(isActive || isPending) && (
                <span className={`${styles.accentBar} ${isPending ? styles.accentBarAmber : ''}`} />
              )}

              <div className={styles.cardTop}>
                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{d.title}</h3>
                  <StatusBadge status={d.status} />
                </div>
                <span className={styles.cardTime}>
                  <Clock size={11} /> {formatDateShort(d.createdAt)}
                </span>
              </div>

              <div className={styles.addressList}>
                <div className={styles.addressRow}>
                  <span className={`${styles.addressIcon} ${styles.addressIconPickup}`}>
                    <MapPin size={15} />
                  </span>
                  <span className={styles.addressTextWrap}>
                    <span className={styles.addressLabel}>{t('myDeliveries.pickup')}</span>
                    <span className={styles.addressText}>{d.pickupAddress}</span>
                  </span>
                </div>
                <div className={styles.addressRow}>
                  <span className={`${styles.addressIcon} ${styles.addressIconDrop}`}>
                    <Flag size={15} />
                  </span>
                  <span className={styles.addressTextWrap}>
                    <span className={styles.addressLabel}>{t('myDeliveries.dropoff')}</span>
                    <span className={styles.addressText}>{d.deliveryAddress}</span>
                  </span>
                </div>
              </div>

              {d.scheduledDate && (
                <div className={styles.infoRow}>
                  <CalendarDays size={15} className={styles.infoIcon} />
                  {t('myDeliveries.scheduled')} {formatDate(d.scheduledDate)}
                </div>
              )}

              {d.vehicle && (
                <div className={styles.infoRow}>
                  <Truck size={15} className={styles.infoIcon} />
                  {d.vehicle.brand} {d.vehicle.model} ({d.vehicle.licensePlate})
                </div>
              )}

              {d.notes && (
                <div className={styles.notesBox}>
                  <StickyNote size={13} className={styles.notesIcon} />
                  <span>{d.notes}</span>
                </div>
              )}

              <div className={styles.actions}>
                <ActionButtons
                  status={d.status}
                  loading={updateMutation.isPending || gpsLoading}
                  onAction={(status) => handleStatusUpdate(d.id, status)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const classMap: Record<string, string> = {
    pending: styles.statusPending,
    assigned: styles.statusAssigned,
    in_progress: styles.statusInProgress,
    delivered: styles.statusDelivered,
    failed: styles.statusFailed,
    cancelled: styles.statusCancelled,
  };
  const labelMap: Record<string, string> = {
    pending: t('myDeliveries.status.pending'),
    assigned: t('myDeliveries.status.assigned'),
    in_progress: t('myDeliveries.status.in_progress'),
    delivered: t('myDeliveries.status.delivered'),
    failed: t('myDeliveries.status.failed'),
    cancelled: t('myDeliveries.status.cancelled'),
  };
  return (
    <span className={`${styles.statusBadge} ${classMap[status] || styles.statusCancelled}`}>
      {labelMap[status] || status}
    </span>
  );
}

function ActionButtons({ status, loading, onAction }: { status: string; loading: boolean; onAction: (s: string) => void }) {
  const { t } = useTranslation();

  if (status === 'assigned') {
    return (
      <Button
        variant="primary"
        size="sm"
        loading={loading}
        icon={<PackagePlus size={14} />}
        onClick={() => onAction('in_progress')}
      >
        {t('myDeliveries.actions.takeCharge')}
      </Button>
    );
  }

  if (status === 'in_progress') {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          loading={loading}
          icon={<PackageCheck size={14} />}
          onClick={() => onAction('delivered')}
        >
          {t('myDeliveries.actions.deliver')}
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={loading}
          icon={<XCircle size={14} />}
          onClick={() => onAction('failed')}
        >
          {t('myDeliveries.actions.fail')}
        </Button>
      </>
    );
  }

  return null;
}
