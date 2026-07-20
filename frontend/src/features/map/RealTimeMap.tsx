import { useEffect, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { getSocket, PositionUpdate } from '../../services/socket/socket';

// Fix Leaflet default icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const driverIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface RealTimeMapProps {
  deliveryId?: string;
  readOnly?: boolean;
  initialPositions?: { latitude: number; longitude: number }[];
}

function MapBoundsUpdater({ positions }: { positions: { latitude: number; longitude: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions.map((p) => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [positions, map]);
  return null;
}

export default function RealTimeMap({ deliveryId, readOnly, initialPositions }: RealTimeMapProps) {
  const [vehicles, setVehicles] = useState<Map<string, { lat: number; lng: number; name: string; speed?: number; timestamp: string }>>(new Map());
  const [routePath, setRoutePath] = useState<[number, number][]>([]);

  const addPosition = useCallback((update: PositionUpdate) => {
    setVehicles((prev) => {
      const next = new Map(prev);
      next.set(update.driverId, {
        lat: update.latitude,
        lng: update.longitude,
        name: update.driverName,
        speed: update.speed,
        timestamp: update.timestamp,
      });
      return next;
    });

    if (deliveryId && update.deliveryId === deliveryId) {
      setRoutePath((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last[0] !== update.latitude || last[1] !== update.longitude) {
          return [...prev, [update.latitude, update.longitude] as [number, number]];
        }
        return prev;
      });
    }
  }, [deliveryId]);

  useEffect(() => {
    if (readOnly) return;

    const socket = getSocket();
    socket.on('positionUpdate', addPosition);

    return () => {
      socket.off('positionUpdate', addPosition);
    };
  }, [addPosition, readOnly]);

  useEffect(() => {
    if (initialPositions && initialPositions.length > 0) {
      setRoutePath(initialPositions.map((p) => [p.latitude, p.longitude] as [number, number]));
    }
  }, [initialPositions]);

  const allPositions = Array.from(vehicles.entries()).map(([id, v]) => ({
    id,
    ...v,
  }));

  const center: [number, number] = allPositions.length > 0
    ? [allPositions[0].lat, allPositions[0].lng]
    : [48.8566, 2.3522];

  return (
    <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%', minHeight: '400px' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapBoundsUpdater positions={allPositions.map((v) => ({ latitude: v.lat, longitude: v.lng }))} />

      {routePath.length > 1 && (
        <Polyline positions={routePath} color="blue" weight={3} opacity={0.6} />
      )}

      {allPositions.map((v) => (
        <Marker key={v.id} position={[v.lat, v.lng]} icon={driverIcon}>
          <Popup>
            <strong>{v.name}</strong><br />
            {v.speed !== undefined && <span>Speed: {v.speed} km/h<br /></span>}
            <span>Updated: {new Date(v.timestamp).toLocaleTimeString()}</span>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
