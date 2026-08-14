import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api/client';
import { TILE_PROVIDERS } from '../features/map/tileProviders';
import styles from './ClientTrackingPage.module.css';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const pickupIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41],
});

const deliveryIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41],
});

interface GpsPosition {
  latitude: number;
  longitude: number;
  speed: number | null;
  timestamp: string;
}

interface DeliveryDetails {
  id: string;
  title: string;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
  driver?: { firstName: string; lastName: string };
  vehicle?: { brand: string; model: string; licensePlate: string };
}

export default function ClientTrackingPage() {
  const [searchParams] = useSearchParams();
  const { t, i18n } = useTranslation();
  const deliveryId = searchParams.get('deliveryId');
  const [positions, setPositions] = useState<GpsPosition[]>([]);
  const [delivery, setDelivery] = useState<DeliveryDetails | null>(null);
  const [error, setError] = useState('');

  const { data: ordersData } = useQuery({
    queryKey: ['my-orders'],
    queryFn: () => api.get('/deliveries/my-orders').then((r) => r.data),
  });

  useEffect(() => {
    if (!deliveryId) return;
    let cancelled = false;

    const fetchData = () => {
      Promise.all([
        api.get(`/deliveries/${deliveryId}`),
        api.get(`/tracking/positions/${deliveryId}`),
      ])
        .then(([delRes, posRes]) => {
          if (cancelled) return;
          setDelivery(delRes.data);
          setPositions(posRes.data);
          setError('');
        })
        .catch(() => {
          if (!cancelled) setError(t('clientTracking.loadError'));
        });
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [deliveryId]);

  interface Order {
    id: string;
    status: string;
    title?: string;
    deliveryAddress?: string;
  }
  const orders: Order[] = ordersData?.data ?? [];

  if (!deliveryId) {
    return (
      <div className={styles.page}>
        <h1>{t('clientTracking.title')}</h1>
        {orders.length === 0 && (
          <div className={styles.emptyState}>
            <p>{t('clientTracking.noActiveOrders')}</p>
          </div>
        )}
        {orders.filter((o) => o.status === 'in_progress' || o.status === 'assigned').length === 0 && (
          <div className={styles.emptyState}>
            <p>{t('clientTracking.noInProgress')}</p>
          </div>
        )}
        <div className={styles.orderList}>
          {orders
            .filter((o) => o.status === 'in_progress' || o.status === 'assigned')
            .map((o) => (
              <div
                key={o.id}
                onClick={() => window.location.href = `/tracking?deliveryId=${o.id}`}
                className={styles.orderCard}
              >
                <strong className={styles.orderTitle}>{o.title}</strong>
                <span className={styles.orderStatusBadge} style={{
                  background: o.status === 'in_progress' ? 'var(--color-blue)' : 'var(--color-teal)',
                }}>
                  {o.status === 'in_progress' ? t('clientTracking.status.in_progress') : t('clientTracking.status.assigned')}
                </span>
                <div className={styles.orderAddress}>
                  📦 {o.deliveryAddress}
                </div>
              </div>
            ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageCentered}>
        <h1>{t('clientTracking.title')}</h1>
        <p>{error}</p>
      </div>
    );
  }

  const path: [number, number][] = positions.map((p) => [p.latitude, p.longitude]);
  const currentPos = positions[positions.length - 1];
  const center: [number, number] = currentPos
    ? [currentPos.latitude, currentPos.longitude]
    : [delivery?.pickupLat ?? -18.8792, delivery?.pickupLng ?? 47.5079];

  return (
    <div className={styles.mapContainer}>
      {delivery && (
        <div className={styles.deliveryInfo}>
          <h2 className={styles.deliveryTitle}>{delivery.title}</h2>
          <div className={styles.deliveryDetails}>
            <div>📦 {delivery.deliveryAddress}</div>
            {delivery.driver && <div>👤 {t('clientTracking.driver')} : {delivery.driver.firstName} {delivery.driver.lastName}</div>}
            {delivery.vehicle && <div>🚛 {t('clientTracking.vehicle')} : {delivery.vehicle.brand} {delivery.vehicle.model} ({delivery.vehicle.licensePlate})</div>}
            {currentPos?.speed != null && (
              <div>⚡ {t('clientTracking.speed')} : {(currentPos.speed * 3.6).toFixed(1)} km/h</div>
            )}
          </div>
        </div>
      )}
      <div className={styles.mapArea}>
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution={TILE_PROVIDERS.plan.attribution}
            url={TILE_PROVIDERS.plan.url}
            maxZoom={TILE_PROVIDERS.plan.maxZoom}
            detectRetina
          />
          <Polyline positions={path} color="blue" weight={3} opacity={0.6} />
          {currentPos && (
            <Marker position={[currentPos.latitude, currentPos.longitude]}>
              <Popup>
                {t('clientTracking.currentPosition')}<br />
                {t('clientTracking.speed')} : {((currentPos.speed ?? 0) * 3.6).toFixed(1)} km/h<br />
                {new Date(currentPos.timestamp).toLocaleString(i18n.language)}
              </Popup>
            </Marker>
          )}
          {delivery?.pickupLat && delivery?.pickupLng && (
            <Marker position={[delivery.pickupLat, delivery.pickupLng]} icon={pickupIcon}>
              <Popup>{t('clientTracking.pickup')} : {delivery.pickupAddress}</Popup>
            </Marker>
          )}
          {delivery?.deliveryLat && delivery?.deliveryLng && (
            <Marker position={[delivery.deliveryLat, delivery.deliveryLng]} icon={deliveryIcon}>
              <Popup>{t('clientTracking.dropoff')} : {delivery.deliveryAddress}</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}