import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api/client';
import type { DeliveryInfo } from '../../types';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const deliveryIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41],
});

interface Position {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
}

const POLL_INTERVAL_MS = 15000;

export default function PublicTrackingPage() {
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
        setLastUpdate(new Date().toLocaleTimeString('fr-FR'));
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
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h2>Tracking Unavailable</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!delivery) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading...</div>;
  }

  const path: [number, number][] = positions.map((p) => [p.latitude, p.longitude]);
  const currentPos = positions[positions.length - 1];
  const center: [number, number] = currentPos
    ? [currentPos.latitude, currentPos.longitude]
    : [delivery.pickupLat || -18.8792, delivery.pickupLng || 47.5079];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px', background: '#fff', borderBottom: '1px solid #ddd' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{delivery.title}</h2>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: '#28a745', animation: 'dt-pulse-moving 2s ease-out infinite',
          }} />
          <span style={{ fontSize: '0.8rem', color: '#28a745', fontWeight: 600 }}>LIVE</span>
          {lastUpdate && <span style={{ fontSize: '0.75rem', color: '#999' }}>Updated: {lastUpdate}</span>}
        </div>
        <p>Status: <strong>{delivery.status}</strong></p>
        <p>Pickup: {delivery.pickupAddress}</p>
        <p>Delivery: {delivery.deliveryAddress}</p>
        {currentPos?.speed !== undefined && currentPos?.speed !== null && <p>Current speed: {(currentPos.speed * 3.6).toFixed(1)} km/h</p>}
      </div>
      <div style={{ flex: 1 }}>
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
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
