import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import MapLayerSwitcher from '../components/MapLayerSwitcher';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api/client';
import Button from '../components/Button';
import type { Delivery } from '../types';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

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
  const { t } = useTranslation();
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
    <div style={{
      padding: 'var(--space-2xl, 32px)',
      background: 'var(--color-bg, #0B1220)', minHeight: '100vh',
    }}>
      <h1 style={{
        color: 'var(--color-text, #E8ECF3)',
        fontFamily: 'var(--font-display, Space Grotesk, sans-serif)',
        fontSize: 'var(--text-2xl, 1.5rem)', fontWeight: 700,
        marginBottom: 'var(--space-lg, 16px)',
      }}>
        {t('trackingReplay.title') || 'Trip Replay'}
      </h1>

      <div style={{ display: 'flex', gap: 'var(--space-md, 12px)', alignItems: 'center', marginBottom: 'var(--space-lg, 16px)' }}>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={{
            padding: 'var(--space-sm, 8px) var(--space-md, 12px)',
            flex: 1, maxWidth: 400,
            border: '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
            borderRadius: 'var(--radius-md, 6px)',
            background: 'var(--color-input-bg, #121B2E)',
            color: 'var(--color-text, #E8ECF3)',
            fontSize: 'var(--text-sm, 0.875rem)',
            outline: 'none',
            fontFamily: 'var(--font-body, Inter, sans-serif)',
          }}
        >
          <option value="">-- Select delivery --</option>
          {deliveries.map((d) => (
            <option key={d.id} value={d.id}>{d.title}</option>
          ))}
        </select>
      </div>

      {positions.length > 0 && (
        <>
          <div style={{
            height: 500,
            borderRadius: 'var(--radius-lg, 8px)',
            overflow: 'hidden',
            marginBottom: 'var(--space-lg, 16px)',
            border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
          }}>
            <MapContainer center={center} zoom={14} style={{ height: '100%', width: '100%' }}>
              <MapLayerSwitcher />
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {path.length > 1 && (
                <Polyline positions={path} color="#F2A93C" weight={3} opacity={0.6} />
              )}
              {matchedPath && matchedPath.length > 1 && (
                <Polyline positions={matchedPath} color="#3FA796" weight={4} opacity={0.8} />
              )}
              {currentPos && <ReplayMarker position={[currentPos.latitude, currentPos.longitude]} />}
            </MapContainer>
          </div>

          <div style={{
            display: 'flex', gap: 'var(--space-md, 12px)', alignItems: 'center',
            flexWrap: 'wrap',
            padding: 'var(--space-lg, 16px)',
            background: 'var(--color-surface, #121B2E)',
            borderRadius: 'var(--radius-lg, 8px)',
            border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
          }}>
            <button
              onClick={() => setPlaying(!playing)}
              style={{
                padding: 'var(--space-sm, 8px) var(--space-lg, 16px)',
                background: playing ? '#dc3545' : '#22c55e',
                color: '#fff', border: 'none',
                borderRadius: 'var(--radius-md, 6px)',
                cursor: 'pointer', fontWeight: 600,
                fontSize: 'var(--text-sm, 0.875rem)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {playing ? '⏹ Stop' : '▶ Play'}
            </button>

            {[1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                style={{
                  padding: 'var(--space-sm, 6px) var(--space-md, 12px)',
                  border: s === speed
                    ? '2px solid var(--color-accent, #F2A93C)'
                    : '1px solid var(--color-input-border, rgba(232,236,243,0.15))',
                  borderRadius: 'var(--radius-md, 6px)',
                  cursor: 'pointer',
                  background: s === speed
                    ? 'var(--color-accent-bg, rgba(242,169,60,0.08))'
                    : 'var(--color-surface, #121B2E)',
                  color: s === speed
                    ? 'var(--color-accent, #F2A93C)'
                    : 'var(--color-text-secondary, #9BA6B9)',
                  fontWeight: s === speed ? 600 : 400,
                  fontSize: 'var(--text-sm, 0.875rem)',
                }}
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
              🗺️ {matchingLoading ? 'Correspondance…' : `Aligner sur route${matchedPath ? ' ✓' : ''}`}
            </Button>

            {matchConfidence > 0 && (
              <span style={{
                fontSize: 'var(--text-xs, 0.75rem)',
                color: 'var(--color-teal, #3FA796)',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                confiance: {(matchConfidence * 100).toFixed(0)}%
              </span>
            )}

            <input
              type="range"
              min={0}
              max={positions.length - 1}
              value={currentIdx}
              onChange={(e) => { setCurrentIdx(Number(e.target.value)); setPlaying(false); }}
              style={{ flex: 1, minWidth: 120, accentColor: 'var(--color-accent, #F2A93C)' }}
            />
            <span style={{
              fontSize: 'var(--text-sm, 0.85rem)',
              color: 'var(--color-text-tertiary, #7A8BA3)',
              fontFamily: 'var(--font-mono, monospace)',
            }}>
              {currentIdx + 1} / {positions.length}
            </span>
          </div>

          {currentPos && (
            <div style={{
              marginTop: 'var(--space-md, 12px)',
              fontSize: 'var(--text-sm, 0.85rem)',
              color: 'var(--color-text-secondary, #9BA6B9)',
              fontFamily: 'var(--font-mono, monospace)',
              padding: 'var(--space-md, 12px)',
              background: 'var(--color-surface, #121B2E)',
              borderRadius: 'var(--radius-md, 6px)',
              border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
            }}>
              Lat: {currentPos.latitude.toFixed(6)}, Lng: {currentPos.longitude.toFixed(6)}
              {currentPos.speed !== undefined && ` | ${(currentPos.speed * 3.6).toFixed(1)} km/h`}
              {' | '}{new Date(currentPos.timestamp).toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}