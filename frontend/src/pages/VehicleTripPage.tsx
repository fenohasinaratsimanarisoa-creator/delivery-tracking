import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Play, Square, Map as MapIcon } from 'lucide-react';
import api from '../services/api/client';
import Button from '../components/Button';
import MapLayerSwitcher from '../components/MapLayerSwitcher';
import { enableRetinaDefaultMarker } from '../features/map/markerIcons';
import { TILE_PROVIDERS } from '../features/map/tileProviders';
import styles from './VehicleTripPage.module.css';

enableRetinaDefaultMarker();

// Leaflet applique la couleur de polyligne via un attribut SVG ("stroke") qui ne
// résout pas les var() CSS — on lit le token à l'exécution (même pattern que
// TripReplayPage / RealTimeMap), fallback hex.
function themeColor(varName: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  } catch {
    return fallback;
  }
}

interface VehicleOption {
  id: string;
  brand?: string | null;
  model?: string | null;
  licensePlate: string;
}

interface TripPosition {
  latitude: number;
  longitude: number;
  timestamp: string;
  speed?: number | null;
  accuracy?: number | null;
}

interface TripReport {
  totalDistance: { meters: number; kilometers: number };
  avgSpeedKmh: number;
  totalDurationSec: number;
  stopCount: number;
  positionCount: number;
  trackingCoveragePct: number;
  signalGaps: unknown[];
}

interface VehicleTrip {
  vehicleId: string;
  vehiclePlate: string | null;
  vehicleLabel: string | null;
  date: string;
  positions: TripPosition[];
  report: TripReport;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function ReplayMarker({ position }: { position: [number, number] }) {
  const map = useMap();
  const ref = useRef<L.Marker | null>(null);
  useEffect(() => {
    ref.current = L.marker(position).addTo(map);
    return () => {
      if (ref.current) map.removeLayer(ref.current);
    };
    // position volontairement absent : mise à jour gérée par l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  useEffect(() => {
    if (ref.current) ref.current.setLatLng(position);
  }, [position]);
  return null;
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.length;
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    }
  }, [key, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function VehicleTripPage() {
  const { t, i18n } = useTranslation();
  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [trip, setTrip] = useState<VehicleTrip | null>(null);
  const [loading, setLoading] = useState(false);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [matched, setMatched] = useState<[number, number][] | null>(null);
  const [matchConf, setMatchConf] = useState(0);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    api
      .get('/vehicles/list')
      .then((r) => setVehicles((r.data as VehicleOption[]) ?? []))
      .catch(() => setVehicles([]));
  }, []);

  useEffect(() => {
    if (!vehicleId) {
      setTrip(null);
      return;
    }
    setLoading(true);
    setMatched(null);
    setMatchConf(0);
    setIdx(0);
    setPlaying(false);
    api
      .get(`/tracking/vehicle-trip/${vehicleId}`, { params: { date } })
      .then((r) => setTrip(r.data as VehicleTrip))
      .catch(() => setTrip(null))
      .finally(() => setLoading(false));
  }, [vehicleId, date]);

  const positions = useMemo<TripPosition[]>(() => trip?.positions ?? [], [trip]);
  const rawPath: [number, number][] = useMemo(
    () => positions.map((p) => [p.latitude, p.longitude]),
    [positions],
  );

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (!playing || positions.length === 0) return;
    const spanMs =
      positions.length > 1
        ? new Date(positions[positions.length - 1].timestamp).getTime() -
          new Date(positions[0].timestamp).getTime()
        : 1000;
    const step = Math.max(50, Math.min(4000, spanMs / positions.length / speed));
    timer.current = setInterval(() => {
      setIdx((p) => {
        if (p >= positions.length - 1) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, step);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, speed, positions]);

  const applyMatch = async () => {
    if (positions.length < 2) return;
    setMatching(true);
    try {
      const res = await api.post('/routing/match', {
        coordinates: positions.map((p) => [p.latitude, p.longitude]),
        radiuses: positions.map((p) => Math.max(15, Math.min(50, p.accuracy ?? 25))),
        profile: 'driving',
      });
      const data = res.data as { matchedPolyline: [number, number][]; confidence: number };
      setMatched(data.matchedPolyline ?? null);
      setMatchConf(data.confidence ?? 0);
    } catch {
      setMatched(null);
      setMatchConf(0);
    } finally {
      setMatching(false);
    }
  };

  const cur = positions[idx];
  const traveled: [number, number][] = rawPath.slice(0, idx + 1);
  const center: [number, number] = cur
    ? [cur.latitude, cur.longitude]
    : [-18.8792, 47.5079];
  // Trace brute : rouge vif volontairement hors palette + halo sombre, pour
  // rester lisible sur l'imagerie satellite (terrain ocre) comme sur fond clair.
  const rawColor = '#FF1F1F';
  const roadColor = themeColor('--color-teal', '#3FA796');
  const maxZoom = Math.max(...Object.values(TILE_PROVIDERS).map((p) => p.maxZoom));
  const rep = trip?.report;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t('vehicleTrip.title')}</h1>

      <div className={styles.controlsRow}>
        <select
          className={styles.select}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          <option value="">{t('vehicleTrip.selectVehicle')}</option>
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {[v.brand, v.model].filter(Boolean).join(' ') || v.licensePlate} · {v.licensePlate}
            </option>
          ))}
        </select>
        <label>
          {t('vehicleTrip.date')}{' '}
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      {rep && (
        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t('vehicleTrip.distance')}</span>
            <span className={styles.statValue}>{rep.totalDistance.kilometers} km</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t('vehicleTrip.duration')}</span>
            <span className={styles.statValue}>{fmtDuration(rep.totalDurationSec)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t('vehicleTrip.stops')}</span>
            <span className={styles.statValue}>{rep.stopCount}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t('vehicleTrip.coverage')}</span>
            <span
              className={`${styles.statValue} ${rep.trackingCoveragePct < 80 ? styles.warn : ''}`}
            >
              {rep.trackingCoveragePct}%
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>{t('vehicleTrip.gaps')}</span>
            <span
              className={`${styles.statValue} ${rep.signalGaps.length > 0 ? styles.warn : ''}`}
            >
              {rep.signalGaps.length}
            </span>
          </div>
        </div>
      )}

      {!loading && trip && positions.length === 0 && (
        <div className={styles.empty}>{t('vehicleTrip.noData')}</div>
      )}

      {positions.length > 0 && (
        <>
          <div className={styles.mapArea}>
            <MapContainer center={center} zoom={14} maxZoom={maxZoom} style={{ height: '100%', width: '100%' }}>
              <MapLayerSwitcher />
              <FitBounds points={matched && matched.length > 1 ? matched : rawPath} />
              {traveled.length > 1 && (
                <>
                  <Polyline positions={traveled} color="#000000" weight={9} opacity={0.35} />
                  <Polyline positions={traveled} color={rawColor} weight={5} opacity={1} />
                </>
              )}
              {matched && matched.length > 1 && (
                <Polyline positions={matched} color={roadColor} weight={4} opacity={0.9} dashArray="3 7" />
              )}
              {cur && <ReplayMarker position={[cur.latitude, cur.longitude]} />}
            </MapContainer>
          </div>

          <div className={styles.playbackControls}>
            <button
              onClick={() => setPlaying((p) => !p)}
              className={`${styles.playBtn} ${playing ? styles.playBtnPlaying : styles.playBtnStopped}`}
            >
              {playing ? (
                <>
                  <Square size={14} /> Stop
                </>
              ) : (
                <>
                  <Play size={14} /> Play
                </>
              )}
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
            <Button variant="secondary" size="sm" onClick={applyMatch} disabled={matching || positions.length < 2}>
              <MapIcon size={14} />{' '}
              {matching ? t('vehicleTrip.snapping') : `${t('vehicleTrip.snapToRoad')}${matched ? ' ✓' : ''}`}
            </Button>
            {matchConf > 0 && (
              <span className={styles.matchConfidence}>
                {t('vehicleTrip.confidence')}: {(matchConf * 100).toFixed(0)}%
              </span>
            )}
            <input
              type="range"
              min={0}
              max={positions.length - 1}
              value={idx}
              onChange={(e) => {
                setIdx(Number(e.target.value));
                setPlaying(false);
              }}
              className={styles.slider}
            />
            <span className={styles.positionCounter}>
              {idx + 1} / {positions.length}
            </span>
          </div>

          <div className={styles.legend}>
            <span>
              <span className={styles.legendDot} style={{ background: rawColor }} />
              {t('vehicleTrip.rawTrace')}
            </span>
            {matched && (
              <span>
                <span className={styles.legendDot} style={{ background: roadColor }} />
                {t('vehicleTrip.roadTrace')}
              </span>
            )}
            {cur && (
              <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                {cur.latitude.toFixed(6)}, {cur.longitude.toFixed(6)}
                {cur.speed != null && cur.speed > 0.5 ? ` · ${(cur.speed * 3.6).toFixed(0)} km/h` : ''}
                {' · '}
                {new Date(cur.timestamp).toLocaleString(i18n.language)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
