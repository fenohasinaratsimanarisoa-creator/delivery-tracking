import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Marker, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowLeft, MapPin, Package, Clock, User, Truck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../services/i18n/formatDate';
import api from '../services/api/client';
import type { Delivery } from '../types';
import styles from './DeliveryDetailPage.module.css';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b', assigned: '#06b6d4', in_progress: '#3b82f6',
  delivered: '#22c55e', failed: '#ef4444', cancelled: '#6b7280',
};

export default function DeliveryDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const { data: delivery, isLoading } = useQuery({
    queryKey: ['delivery', id],
    queryFn: () => api.get(`/deliveries/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  if (isLoading) {
    return <div className={styles.loading}>{t('deliveryDetail.loading')}</div>;
  }

  const d = delivery as Delivery | null;
  if (!d) {
    return (
      <div className={styles.notFound}>
        <h2 className={styles.notFoundTitle}>{t('deliveryDetail.notFound')}</h2>
        <Link to="/deliveries" className={styles.notFoundLink}>{t('deliveryDetail.backToList')}</Link>
      </div>
    );
  }

  const hasCoords = d.pickupLat && d.pickupLng && d.deliveryLat && d.deliveryLng;
  const center: [number, number] = hasCoords
    ? [(d.pickupLat! + d.deliveryLat!) / 2, (d.pickupLng! + d.deliveryLng!) / 2]
    : [-18.8792, 47.5079];

  return (
    <div className={styles.page}>
      <Link to="/deliveries" className={styles.backLink}>
        <ArrowLeft size={16} /> {t('deliveryDetail.backToDeliveries')}
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{d.title}</h1>
          {d.description && <p className={styles.description}>{d.description}</p>}
        </div>
        <span className={styles.statusBadge} style={{
          background: `${STATUS_COLORS[d.status] || '#6b7280'}20`,
          color: STATUS_COLORS[d.status] || '#6b7280',
        }}>{t(`deliveryDetail.status${d.status.charAt(0).toUpperCase() + d.status.slice(1)}`)}</span>
      </div>

      <div className={styles.infoGrid}>
        <InfoCard icon={<MapPin size={16} />} label={t('deliveryDetail.infoPickup')} value={d.pickupAddress} />
        <InfoCard icon={<MapPin size={16} />} label={t('deliveryDetail.infoDelivery')} value={d.deliveryAddress} />
        {d.driver && <InfoCard icon={<User size={16} />} label={t('deliveryDetail.infoDriver')} value={`${d.driver.firstName} ${d.driver.lastName}`} />}
        {d.vehicle && <InfoCard icon={<Truck size={16} />} label={t('deliveryDetail.infoVehicle')} value={`${d.vehicle.brand} ${d.vehicle.model} (${d.vehicle.licensePlate})`} />}
        {d.scheduledDate && <InfoCard icon={<Clock size={16} />} label={t('deliveryDetail.infoScheduledDate')} value={formatDate(d.scheduledDate)} />}
        <InfoCard icon={<Package size={16} />} label={t('deliveryDetail.infoCreatedDate')} value={formatDate(d.createdAt)} />
        {d.clientPhone && <InfoCard icon={<User size={16} />} label="Téléphone client" value={d.clientPhone} />}
        {d.amount !== undefined && d.amount !== null && <InfoCard icon={<Package size={16} />} label="Montant" value={`${d.amount.toLocaleString('fr-FR')} Ar`} />}
        {d.articlePrice !== undefined && d.articlePrice !== null && <InfoCard icon={<Package size={16} />} label="Prix article" value={`${d.articlePrice.toLocaleString('fr-FR')} Ar`} />}
        {d.productDescription && <InfoCard icon={<Package size={16} />} label="Produits" value={d.productDescription} />}
        {d.externalOrderRef && <InfoCard icon={<Package size={16} />} label="N° Commande" value={d.externalOrderRef} />}
      </div>

      {d.notes && (
        <div className={styles.notes}>
          📝 {d.notes}
        </div>
      )}

      {hasCoords && (
        <div className={styles.mapContainer}>
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution='&copy; OSM' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[d.pickupLat!, d.pickupLng!]} />
            <Marker position={[d.deliveryLat!, d.deliveryLng!]} />
            <Polyline positions={[[d.pickupLat!, d.pickupLng!], [d.deliveryLat!, d.deliveryLng!]]} color="#3B82F6" weight={3} dashArray="10 6" />
          </MapContainer>
        </div>
      )}
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.infoCard}>
      <div className={styles.infoCardLabel}>
        {icon} {label}
      </div>
      <div className={styles.infoCardValue}>{value || '—'}</div>
    </div>
  );
}
