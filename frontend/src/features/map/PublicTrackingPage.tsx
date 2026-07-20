import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../../services/api/client';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const deliveryIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41],
});

interface DeliveryInfo {
  id: string;
  title: string;
  status: string;
  pickupAddress: string;
  deliveryAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  deliveryLat?: number;
  deliveryLng?: number;
}

interface Position {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
}

export default function PublicTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api.get(`/tracking/public/${token}`)
      .then((res) => {
        setDelivery(res.data.delivery);
        setPositions(res.data.positions);
      })
      .catch(() => setError('Invalid or expired tracking link'));
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
    : [delivery.pickupLat || 48.8566, delivery.pickupLng || 2.3522];

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px', background: '#fff', borderBottom: '1px solid #ddd' }}>
        <h2>{delivery.title}</h2>
        <p>Status: <strong>{delivery.status}</strong></p>
        <p>Pickup: {delivery.pickupAddress}</p>
        <p>Delivery: {delivery.deliveryAddress}</p>
        {currentPos?.speed !== undefined && <p>Current speed: {currentPos.speed} km/h</p>}
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
                Speed: {currentPos.speed || 0} km/h<br />
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
