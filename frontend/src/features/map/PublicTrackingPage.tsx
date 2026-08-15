import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api/client';
import ResilientTileLayer from './ResilientTileLayer';
import { enableRetinaDefaultMarker, createPinIcon } from './markerIcons';
import { TILE_PROVIDERS } from './tileProviders';
import type { DeliveryInfo } from '../../types';
import styles from './PublicTrackingPage.module.css';

// Marqueur par défaut en version @2x sur écrans HiDPI (Retina/4K).
enableRetinaDefaultMarker();

// Point pickup/livraison : pin SVG vectoriel (remplace le PNG raster hébergé
// sur GitHub, 25×41 sans variante @2x) — net sur tout écran, sans dépendance externe.
const deliveryIcon = createPinIcon('var(--color-red)');

interface Position {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
}

const POLL_INTERVAL_MS = 15000;

export default function PublicTrackingPage() {
  const { i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTracking = () => {
    if (!token) return;
    api.get(`/tracking/public/${token}`)
      .then((res) => {
        setDelivery(res.data.delivery);
        setPositions(res.data.positions);
        setLastUpdate(new Date().toLocaleTimeString(i18n.language));
      })
        .catch(() => setError('Invalid or expired tracking link'));
  };

  useEffect(() => {
    fetchTracking();
    intervalRef.current = setInterval(fetchTracking, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [token]);

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <div className={styles.errorCard}>
          <h2>Tracking Unavailable</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!delivery) {
    return <div className={styles.loadingContainer}>Loading...</div>;
  }

  const path: [number, number][] = positions.map((p) => [p.latitude, p.longitude]);
  const currentPos = positions[positions.length - 1];
  const center: [number, number] = currentPos
    ? [currentPos.latitude, currentPos.longitude]
    : [delivery.pickupLat || -18.8792, delivery.pickupLng || 47.5079];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <h2 className={styles.headerTitle}>{delivery.title}</h2>
          <span className={styles.liveDot} />
          <span className={styles.liveLabel}>LIVE</span>
          {lastUpdate && <span className={styles.lastUpdate}>Updated: {lastUpdate}</span>}
        </div>
        <p>Status: <strong>{delivery.status}</strong></p>
        <p>Pickup: {delivery.pickupAddress}</p>
        <p>Delivery: {delivery.deliveryAddress}</p>
        {currentPos?.speed !== undefined && currentPos?.speed !== null && <p>Current speed: {(currentPos.speed * 3.6).toFixed(1)} km/h</p>}
      </div>
      <div className={styles.mapContainer}>
        <MapContainer center={center} zoom={13} maxZoom={Math.max(...Object.values(TILE_PROVIDERS).map((p) => p.maxZoom))} style={{ height: '100%', width: '100%' }}>
          <ResilientTileLayer />
          <Polyline positions={path} color="blue" weight={3} opacity={0.6} />
          {currentPos && (
            <Marker position={[currentPos.latitude, currentPos.longitude]}>
              <Popup>
                Current position<br />
                Speed: {((currentPos.speed ?? 0) * 3.6).toFixed(1)} km/h<br />
                {new Date(currentPos.timestamp).toLocaleString()}
              </Popup>
            </Marker>
          )}
          {delivery.pickupLat && delivery.pickupLng && (
            <Marker position={[delivery.pickupLat, delivery.pickupLng]} icon={deliveryIcon}>
              <Popup>Pickup: {delivery.pickupAddress}</Popup>
            </Marker>
          )}
          {delivery.deliveryLat && delivery.deliveryLng && (
            <Marker position={[delivery.deliveryLat, delivery.deliveryLng]} icon={deliveryIcon}>
              <Popup>Delivery: {delivery.deliveryAddress}</Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  );
}
