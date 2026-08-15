import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import MapLayerSwitcher from '../components/MapLayerSwitcher';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api/client';
import Button from '../components/Button';
import { Play, Square, Map } from 'lucide-react';
import { enableRetinaDefaultMarker } from '../features/map/markerIcons';
import { TILE_PROVIDERS } from '../features/map/tileProviders';
import type { Delivery } from '../types';
import styles from './TripReplayPage.module.css';

// Marqueur par défaut (ReplayMarker) en version @2x sur écrans HiDPI.
enableRetinaDefaultMarker();

// Leaflet applique la couleur de la polyligne via un attribut SVG ("stroke"), qui ne
// supporte pas les var() CSS : on résout les tokens --color-accent/--color-teal à
// l'exécution (même pattern que DeliveryDetailPage.tsx), fallback sur les anciens hex.
function themeColor(varName: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  } catch {
    return fallback;
  }
}

interface Position {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number;
}

function ReplayMarker({ position }: { position: [number, number] }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!markerRef.current) {
      markerRef.current = L.marker(position).addTo(map);
    } else {
      markerRef.current.setLatLng(position);
    }
    return () => {
      if (markerRef.current) map.removeLayer(markerRef.current);
    };
  }, [map]);

  useEffect(() => {
    if (markerRef.current) markerRef.current.setLatLng(position);
  }, [position]);

  return null;
}

export default function TripReplayPage() {
  const { t, i18n } = useTranslation();
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [matchedPath, setMatchedPath] = useState<[number, number][] | null>(null);
  const [matchConfidence, setMatchConfidence] = useState(0);
  const [matchingLoading, setMatchingLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get('/deliveries').then((r) => setDeliveries(r.data?.data ?? r.data ?? []));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    api.get(`/tracking/positions/${selectedId}`).then((r) => {
      const data = r.data?.data ?? r.data ?? [];
      setPositions(Array.isArray(data) ? data : []);
      setCurrentIdx(0);
      setPlaying(false);
      setMatchedPath(null);
      setMatchConfidence(0);
    });
  }, [selectedId]);

  const applyMapMatching = async () => {
    if (positions.length < 2) return;
    setMatchingLoading(true);
    try {
      const coords = positions.map((p) => [p.latitude, p.longitude] as [number, number]);
      const res = await api.post('/routing/match', {
        coordinates: coords,
        profile: 'driving',
      });
      const data = res.data as { matchedPolyline: [number, number][]; confidence: number };
      setMatchedPath(data.matchedPolyline);
      setMatchConfidence(data.confidence);
    } catch {
      setMatchedPath(null);
      setMatchConfidence(0);
    } finally {
      setMatchingLoading(false);
    }
  };

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!playing || positions.length === 0) return;

    const baseInterval = positions.length > 1
      ? (new Date(positions[positions.length - 1].timestamp).getTime() - new Date(positions[0].timestamp).getTime()) / positions.length / speed
      : 1000;

    intervalRef.current = setInterval(() => {
      setCurrentIdx((prev) => {
        if (prev >= positions.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, Math.max(50, Math.min(5000, baseInterval)));
  }, [playing, speed, positions]);

  const currentPos: Position | undefined = positions[currentIdx];
  const path: [number, number][] = positions.slice(0, currentIdx + 1).map((p) => [p.latitude, p.longitude]);
  const center: [number, number] = currentPos
    ? [currentPos.latitude, currentPos.longitude]
    : [-18.8792, 47.5079];

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>
        {t('trackingReplay.title') || 'Trip Replay'}
      </h1>

      <div className={styles.controlsRow}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className={styles.select}
        >
          <option value="">-- Select delivery --</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </div>

      {positions.length > 0 && (
        <>
          <div className={styles.mapArea}>
            <MapContainer center={center} zoom={14} maxZoom={Math.max(...Object.values(TILE_PROVIDERS).map((p) => p.maxZoom))} style={{ height: '100%', width: '100%' }}>
              <MapLayerSwitcher />
              {path.length > 1 && (
                <Polyline positions={path} color={themeColor('--color-accent', '#F2A93C')} weight={3} opacity={0.6} />
              )}
              {matchedPath && matchedPath.length > 1 && (
                <Polyline positions={matchedPath} color={themeColor('--color-teal', '#3FA796')} weight={4} opacity={0.8} />
              )}
              {currentPos && <ReplayMarker position={[currentPos.latitude, currentPos.longitude]} />}
            </MapContainer>
          </div>

          <div className={styles.playbackControls}>
            <button
              onClick={() => setPlaying(!playing)}
              className={`${styles.playBtn} ${playing ? styles.playBtnPlaying : styles.playBtnStopped}`}
            >
              {playing ? <><Square size={14} /> Stop</> : <><Play size={14} /> Play</>}
            </button>

            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`${styles.speedBtn} ${s === speed ? styles.speedBtnActive : styles.speedBtnInactive}`}
              >
                {s}x
              </button>
            ))}

            <Button
              variant="secondary"
              size="sm"
              onClick={applyMapMatching}
              disabled={matchingLoading || positions.length < 2}
            >
              <Map size={14} /> {matchingLoading ? 'Correspondance…' : `Aligner sur route${matchedPath ? ' ✓' : ''}`}
            </Button>

            {matchConfidence > 0 && (
              <span className={styles.matchConfidence}>
                confiance: {(matchConfidence * 100).toFixed(0)}%
              </span>
            )}

            <input
              type="range"
              min={0}
              max={positions.length - 1}
              value={currentIdx}
              onChange={(e) => { setCurrentIdx(Number(e.target.value)); setPlaying(false); }}
              className={styles.slider}
            />
            <span className={styles.positionCounter}>
              {currentIdx + 1} / {positions.length}
            </span>
          </div>

          {currentPos && (
            <div className={styles.positionInfo}>
              Lat: {currentPos.latitude.toFixed(6)}, Lng: {currentPos.longitude.toFixed(6)}
              {currentPos.speed !== undefined && ` | ${(currentPos.speed * 3.6).toFixed(1)} km/h`}
              {' | '}{new Date(currentPos.timestamp).toLocaleString(i18n.language)}
            </div>
          )}
        </>
      )}
    </div>
  );
}