import { useState, useEffect, type CSSProperties } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ClipboardList, MapPin, Flag, CalendarDays, Truck, StickyNote,
  PackagePlus, PackageCheck, XCircle, Inbox, Navigation,
  Radio, WifiOff, Cpu, AlertTriangle, ChevronDown, Signal, ShieldAlert, Crosshair,
} from 'lucide-react';
import { formatDate, formatDateShort } from '../services/i18n/formatDate';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import Button from '../components/Button';
import Badge from '../components/Badge';
import { DELIVERY_STATUS_VARIANT } from '../services/deliveryStatus';
import { useDataUpdates } from '../hooks/useDataUpdates';
import { useAuth } from '../hooks/AuthContext';
import { useTrackingStatus } from '../services/tracking/TrackingContext';
import type { Delivery } from '../types';
import styles from './MyDeliveriesPage.module.css';

function captureGpsPosition(): Promise<{ latitude: number; longitude: number; accuracy?: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    // Même restriction que le tracking continu (voir useDriverTracking) : sur
    // http:// non-localhost, tous les navigateurs bloquent l'API AVANT la
    // demande de permission — inutile de tenter l'appel, autant distinguer ce
    // cas pour afficher le bon message.
    if (window.isSecureContext === false) {
      reject(new Error('insecure_context'));
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
  const { user } = useAuth();
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
      } catch (err) {
        const message = err instanceof Error && err.message === 'insecure_context'
          ? t('myDeliveries.toast.gpsInsecureContext')
          : t('myDeliveries.toast.gpsRequired');
        toast(message, 'error');
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
          <div className={styles.skeletonCard} style={{ minHeight: 104 }} />
          <div className={styles.skeletonCard} style={{ minHeight: 104 }} />
          <div className={styles.skeletonCard} style={{ minHeight: 104 }} />
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
          <div className={styles.headerTop}>
            <div className={styles.titleIconChip}>
              <ClipboardList size={18} />
            </div>
            <div>
              <h1 className={styles.pageTitle}>{t('myDeliveries.title')}</h1>
              <p className={styles.pageSubtitle}>{t('myDeliveries.subtitle')}</p>
            </div>
          </div>
          {user?.firstName && (
            <p className={styles.hello}>{t('myDeliveries.hello')}, {user.firstName}.</p>
          )}
        </div>
        <LivePill />
      </div>

      <div className={styles.summaryRow}>
        <SummaryCard
          icon={<PackagePlus size={16} />}
          label={t('myDeliveries.summary.toTake')}
          value={toTakeCount}
          color="var(--color-accent)"
        />
        <SummaryCard
          icon={<Navigation size={16} />}
          label={t('myDeliveries.summary.inProgress')}
          value={activeCount}
          color="var(--color-blue)"
        />
        <SummaryCard
          icon={<PackageCheck size={16} />}
          label={t('myDeliveries.summary.done')}
          value={doneCount}
          color="var(--color-teal)"
        />
      </div>

      {sorted.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><Inbox size={28} /></div>
          <p className={styles.emptyTitle}>{t('myDeliveries.title')}</p>
          <p className={styles.emptyText}>{t('myDeliveries.empty')}</p>
        </div>
      )}

      <div className={styles.list}>
        {sorted.map((d, i) => {
          const isActive = d.status === 'in_progress';
          const isPending = d.status === 'assigned';
          return (
            <div
              key={d.id}
              className={`${styles.deliveryCard}${isActive ? ` ${styles.deliveryCardActive}` : ''}${isPending ? ` ${styles.deliveryCardPending}` : ''}`}
              style={{ animationDelay: `${Math.min(i, 6) * 60}ms` } as CSSProperties}
            >
              {(isActive || isPending) && (
                <span className={`${styles.accentBar} ${isPending ? styles.accentBarAmber : ''}`} />
              )}

              <div className={styles.cardTop}>
                <div className={styles.cardIdentity}>
                  <div className={styles.cardTagRow}>
                    <StatusBadge status={d.status} />
                  </div>
                  <h3 className={styles.cardTitle}>{d.title}</h3>
                </div>
                <span className={styles.cardTime}>
                  <ClockIcon />
                  {formatDateShort(d.createdAt)}
                </span>
              </div>

              <div className={styles.route}>
                <div className={styles.routeStop}>
                  <span className={`${styles.addressIcon} ${styles.addressIconPickup}`}>
                    <MapPin size={15} />
                  </span>
                  <span className={styles.addressTextWrap}>
                    <span className={styles.addressLabel}>{t('myDeliveries.pickup')}</span>
                    <span className={styles.addressText}>{d.pickupAddress}</span>
                  </span>
                </div>
                <div className={styles.routeConnector}>
                  <span className={styles.routeLine} />
                </div>
                <div className={styles.routeStop}>
                  <span className={`${styles.addressIcon} ${styles.addressIconDrop}`}>
                    <Flag size={15} />
                  </span>
                  <span className={styles.addressTextWrap}>
                    <span className={styles.addressLabel}>{t('myDeliveries.dropoff')}</span>
                    <span className={styles.addressText}>{d.deliveryAddress}</span>
                  </span>
                </div>
              </div>

              <details className={styles.cardDetails}>
                <summary className={styles.detailsSummary}>
                  <ChevronDown size={14} className={styles.detailsChevron} />
                  {t('myDeliveries.details')}
                </summary>
                <div className={styles.detailsBody}>
                  <div className={styles.infoRowWrap}>
                    {d.scheduledDate && (
                      <div className={styles.infoRow}>
                        <CalendarDays size={14} className={styles.infoIcon} />
                        <span>{t('myDeliveries.scheduled')}</span>
                        <span className={styles.infoValue}>{formatDate(d.scheduledDate)}</span>
                      </div>
                    )}
                    {d.vehicle && (
                      <div className={styles.infoRow}>
                        <Truck size={14} className={styles.infoIcon} />
                        <span>{d.vehicle.brand} {d.vehicle.model}</span>
                        <span className={styles.plateChip}>{d.vehicle.licensePlate}</span>
                      </div>
                    )}
                  </div>

                  {d.notes && (
                    <div className={styles.notesBox}>
                      <StickyNote size={13} className={styles.notesIcon} />
                      <span>{d.notes}</span>
                    </div>
                  )}
                </div>
              </details>

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

function ClockIcon() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
}

function LivePill() {
  const { t } = useTranslation();
  const status = useTrackingStatus();

  const isPhysical = status.positionSource === 'physical_tracker';
  if (isPhysical) {
    return (
      <span className={`${styles.livePill} ${styles.pillTeal}`}>
        <Cpu size={13} />
        {t('trackingIndicator.physicalTracker')}
        <span className={styles.pillPing} />
      </span>
    );
  }
  if (status.insecureContext) {
    return (
      <span className={`${styles.livePill} ${styles.pillRed}`}>
        <AlertTriangle size={13} />
        {t('trackingIndicator.insecureContext')}
      </span>
    );
  }
  if (status.geolocationDenied) {
    return (
      <span className={`${styles.livePill} ${styles.pillRed}`}>
        <AlertTriangle size={13} />
        {t('trackingIndicator.gpsBlocked')}
      </span>
    );
  }
  if (!status.active) {
    return (
      <span className={`${styles.livePill} ${styles.pillMuted}`}>
        <Radio size={13} />
        {t('trackingIndicator.gpsPending')}
      </span>
    );
  }
  // Cas 1 — PAS de réseau téléphone : problème réseau RÉEL, à distinguer d'un
  // simple état du WebSocket (qui peut être down sans que le réseau soit coupé).
  if (!status.networkOnline) {
    return (
      <span className={`${styles.livePill} ${styles.pillRed}`}>
        <Signal size={13} />
        {t('trackingIndicator.noNetwork')}
      </span>
    );
  }
  // Cas 2 — SESSION EXPIRÉE (révoquée par le serveur) : le socket ne pourra pas
  // se reconnecter avec un jeton périmé — afficher la reconnexion manuelle au
  // lieu d'un "Hors ligne" générique qui boucle en silence.
  if (status.sessionExpired) {
    return (
      <span className={`${styles.livePill} ${styles.pillRed}`}>
        <ShieldAlert size={13} />
        {t('trackingIndicator.sessionExpired')}{' '}
        <a href="/login" className={styles.pillLink}>
          {t('trackingIndicator.reconnectCta')}
        </a>
      </span>
    );
  }
  // Hors ligne avec file locale en cours : le chauffeur (et le dispatcher) doivent
  // savoir immédiatement que les positions ne partent PAS en temps réel.
  if (!status.socketConnected && status.queueCount > 0) {
    return (
      <span className={`${styles.livePill} ${styles.pillRed}`}>
        <WifiOff size={13} />
        {t('trackingIndicator.offlineQueue', 'Hors ligne — {{count}} en attente', { count: status.queueCount })}
      </span>
    );
  }
  if (!status.socketConnected) {
    return (
      <span className={`${styles.livePill} ${styles.pillAmber}`}>
        <WifiOff size={13} />
        {t('trackingIndicator.reconnecting', 'Reconnexion…')}
      </span>
    );
  }
  if (status.queueCount > 0) {
    return (
      <span className={`${styles.livePill} ${styles.pillAmber}`}>
        <Radio size={13} />
        {t('trackingIndicator.syncing', 'Synchronisation — {{count}} en attente', { count: status.queueCount })}
      </span>
    );
  }
  if (!status.position) {
    return (
      <span className={`${styles.livePill} ${styles.pillAmber}`}>
        <Radio size={13} />
        {t('trackingIndicator.searching')}
      </span>
    );
  }
  if (status.poorAccuracy) {
    return (
      <span className={`${styles.livePill} ${styles.pillAmber}`}>
        <Crosshair size={13} />
        {t('trackingIndicator.poorAccuracy')}
      </span>
    );
  }
  return (
    <span className={`${styles.livePill} ${styles.pillTeal}`}>
      <Navigation size={13} />
      {status.isStationary ? t('trackingIndicator.stationary') : t('trackingIndicator.moving')}
      <span className={styles.pillPing} />
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const labelMap: Record<string, string> = {
    pending: t('myDeliveries.status.pending'),
    assigned: t('myDeliveries.status.assigned'),
    in_progress: t('myDeliveries.status.in_progress'),
    delivered: t('myDeliveries.status.delivered'),
    failed: t('myDeliveries.status.failed'),
    cancelled: t('myDeliveries.status.cancelled'),
  };
  return (
    <Badge variant={DELIVERY_STATUS_VARIANT[status] || 'neutral'} size="sm" dot>
      {labelMap[status] || status}
    </Badge>
  );
}

function ActionButtons({ status, loading, onAction }: { status: string; loading: boolean; onAction: (s: string) => void }) {
  const { t } = useTranslation();

  if (status === 'assigned') {
    return (
      <Button
        type="button"
        variant="primary"
        size="md"
        className={styles.actionStretch}
        loading={loading}
        icon={<PackagePlus size={15} />}
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
          type="button"
          variant="success"
          size="md"
          className={styles.actionStretch}
          loading={loading}
          icon={<PackageCheck size={15} />}
          onClick={() => onAction('delivered')}
        >
          {t('myDeliveries.actions.deliver')}
        </Button>
        <Button
          type="button"
          variant="danger"
          size="md"
          className={styles.actionStretch}
          loading={loading}
          icon={<XCircle size={15} />}
          onClick={() => onAction('failed')}
        >
          {t('myDeliveries.actions.fail')}
        </Button>
      </>
    );
  }

  return null;
}

function useCountUp(target: number, duration = 600) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

function SummaryCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const animated = useCountUp(value);
  const cardStyle = { '--kpi': color, '--kpi-muted': `${color}1a` } as CSSProperties;
  return (
    <div className={styles.summaryCard} style={cardStyle}>
      <div className={styles.summaryTop}>
        <div className={styles.summaryIcon}>{icon}</div>
      </div>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{animated}</span>
    </div>
  );
}