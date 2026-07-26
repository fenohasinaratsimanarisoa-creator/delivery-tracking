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
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{t('deliveryDetail.loading')}</div>;
  }

  const d = delivery as Delivery | null;
  if (!d) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2 style={{ color: 'var(--color-text)' }}>{t('deliveryDetail.notFound')}</h2>
        <Link to="/deliveries" style={{ color: 'var(--color-accent, #F2A93C)' }}>{t('deliveryDetail.backToList')}</Link>
      </div>
    );
  }

  const hasCoords = d.pickupLat && d.pickupLng && d.deliveryLat && d.deliveryLng;
  const center: [number, number] = hasCoords
    ? [(d.pickupLat! + d.deliveryLat!) / 2, (d.pickupLng! + d.deliveryLng!) / 2]
    : [-18.8792, 47.5079];

  return (
    <div style={{ padding: 'var(--space-xl, 24px)', maxWidth: 900, margin: '0 auto' }}>
      <Link to="/deliveries" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-text-secondary)', textDecoration: 'none', marginBottom: 16, fontSize: '0.85rem' }}>
        <ArrowLeft size={16} /> {t('deliveryDetail.backToDeliveries')}
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem', color: 'var(--color-text)' }}>{d.title}</h1>
          {d.description && <p style={{ color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>{d.description}</p>}
        </div>
        <span style={{
          padding: '4px 14px', borderRadius: 9999, fontSize: '0.8rem', fontWeight: 600,
          background: `${STATUS_COLORS[d.status] || '#6b7280'}20`, color: STATUS_COLORS[d.status] || '#6b7280',
        }}>{t(`deliveryDetail.status${d.status.charAt(0).toUpperCase() + d.status.slice(1)}`)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginBottom: 20 }}>
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
        <div style={{ padding: 12, background: 'var(--color-accent-bg, rgba(242,169,60,0.06))', borderLeft: '3px solid var(--color-accent, #F2A93C)', borderRadius: '0 8px 8px 0', marginBottom: 20, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
          📝 {d.notes}
        </div>
      )}

      {hasCoords && (
        <div style={{ height: 350, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
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
    <div style={{ padding: 14, background: 'var(--color-glass, rgba(18,27,46,0.92))', border: '1px solid var(--color-border-subtle)', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, color: 'var(--color-text-tertiary)', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase' }}>
        {icon} {label}
      </div>
      <div style={{ color: 'var(--color-text)', fontSize: '0.9rem', fontWeight: 500 }}>{value || '—'}</div>
    </div>
  );
}
