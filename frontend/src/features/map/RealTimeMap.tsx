import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { MapContainer, Polyline, useMap } from 'react-leaflet';
import type { Layer } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '../../services/api/client';
import { getSocket, PositionUpdate } from '../../services/socket/socket';
import { formatDate, formatTime } from '../../services/i18n/formatDate';
import { useDevicePerformance } from '../../hooks/useDevicePerformance';
import { getDirections, formatDistance } from '../../services/routing/routingService';
import { predictPosition, maxDeadReckonTime } from '../../services/tracking/deadReckoning';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

import MapLayerSwitcher from '../../components/MapLayerSwitcher';
import styles from './RealTimeMap.module.css';

const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

const EMOJI = '🚗';
const ROUTE_RECALC_MIN_DELAY_MS = 15000;
const ROUTE_RECALC_MIN_DISTANCE_M = 200;
const ROUTE_RECALC_INTERVAL_MS = 30000;

function haloStyle(confidence: number, isMoving: boolean): string {
  const baseColor = isMoving ? '242,169,60' : '63,167,150';
  const opacity = Math.max(0.15, Math.min(0.5, confidence * 0.5));
  const scale = 1 + (1 - confidence) * 0.5;
  return `width:${46 * scale}px;height:${46 * scale}px;border-radius:50%;background:rgba(${baseColor},${opacity * 0.5});border:${2 + confidence * 1}px solid rgba(${baseColor},${opacity});`;
}

function createMovingIcon(rotation = 0, focused = false, confidence = 1) {
  return L.divIcon({
    className: 'dt-marker-vehicle',
    html: `
      <div class="dt-marker-halo" style="${haloStyle(confidence, true)};animation: dt-pulse-moving ${2 - confidence * 0.5}s ease-in-out infinite;"></div>
      <div class="dt-marker-emoji" style="transform: rotate(${rotation}deg);${focused ? 'filter: drop-shadow(0 0 6px var(--color-accent));' : ''}">${EMOJI}</div>
    `,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
}

function createStaticIcon(rotation = 0, focused = false, confidence = 1) {
  return L.divIcon({
    className: 'dt-marker-vehicle',
    html: `
      <div class="dt-marker-halo-static" style="${haloStyle(confidence, false)}"></div>
      <div class="dt-marker-emoji" style="transform: rotate(${rotation}deg);${focused ? 'filter: drop-shadow(0 0 6px var(--color-accent));' : ''}">${EMOJI}</div>
    `,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
}



interface SearchResult {
  id: string;
  type?: string;
  name?: string;
  licensePlate?: string;
  status?: string;
  driverName?: string;
  deliveryAddress?: string;
  coordinates?: [number, number];
  isOffline?: boolean;
  accuracy?: number;
  timestamp?: string;
  vehiclePlate?: string;
  licenseNumber?: string;
}

interface VehicleData {
  id: string;
  lat: number;
  lng: number;
  name: string;
  speed?: number;
  heading?: number;
  timestamp: string;
  status?: string;
  eta?: string | null;
  routeDistance?: number;
  routeDuration?: number;
  accuracy?: number;
  confidence?: number;
  vehicleId?: string;
  deliveryId?: string;
}

function buildIcon(vehicle: VehicleData, focused: boolean) {
  const rotation = vehicle.heading ?? 0;
  const conf = vehicle.confidence ?? 1;
  return vehicle.status === 'moving'
    ? createMovingIcon(rotation, focused, conf)
    : createStaticIcon(rotation, focused, conf);
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function AnimatedMarker({ vehicle, disableAnimation, focused }: { vehicle: VehicleData; disableAnimation?: boolean; focused?: boolean }) {
  const map = useMap();
  const markerRef = useRef<L.Marker | null>(null);
  const animRef = useRef<number>(0);
  const drRef = useRef<number>(0);
  const fromRef = useRef<{ lat: number; lng: number } | null>(null);
  const startTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(500);
  const lastUpdateRef = useRef<number>(Date.now());
  const lastStateRef = useRef<{ lat: number; lng: number; speed: number; heading: number } | null>(null);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;

  useEffect(() => {
    const icon = buildIcon(vehicle, !!focused);
    const marker = L.marker([vehicle.lat, vehicle.lng], { icon, zIndexOffset: focused ? 1000 : 0 }).addTo(map);

    const popupContent = document.createElement('div');
    popupContent.style.minWidth = '180px';
    marker.bindPopup(popupContent);

    markerRef.current = marker;
    fromRef.current = null;

    return () => {
      cancelAnimationFrame(animRef.current);
      cancelAnimationFrame(drRef.current);
      map.removeLayer(marker);
      markerRef.current = null;
    };
  }, [vehicle.id, map, focused]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const icon = buildIcon(vehicle, !!focused);

    cancelAnimationFrame(animRef.current);
    cancelAnimationFrame(drRef.current);

    const now = Date.now();
    lastUpdateRef.current = now;

    lastStateRef.current = {
      lat: vehicle.lat,
      lng: vehicle.lng,
      speed: vehicle.speed ?? 0,
      heading: vehicle.heading ?? 0,
    };

    const from = fromRef.current;
    if (!from || disableAnimation) {
      marker.setLatLng([vehicle.lat, vehicle.lng]);
      marker.setIcon(icon);
      fromRef.current = { lat: vehicle.lat, lng: vehicle.lng };
      return;
    }

    const startLat = from.lat;
    const startLng = from.lng;
    const endLat = vehicle.lat;
    const endLng = vehicle.lng;

    marker.setIcon(icon);

    const dLat = endLat - startLat;
    const dLng = endLng - startLng;
    if (Math.abs(dLat) < 0.00001 && Math.abs(dLng) < 0.00001) {
      marker.setLatLng([endLat, endLng]);
      fromRef.current = { lat: endLat, lng: endLng };
      return;
    }

    const duration = 600;
    startTimeRef.current = performance.now();
    durationRef.current = duration;

    function animate(time: number) {
      const elapsed = time - startTimeRef.current;
      const t = Math.min(elapsed / durationRef.current, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      marker!.setLatLng([startLat + dLat * ease, startLng + dLng * ease]);

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        marker!.setLatLng([endLat, endLng]);
        fromRef.current = { lat: endLat, lng: endLng };
      }
    }

    animRef.current = requestAnimationFrame(animate);
  }, [vehicle.lat, vehicle.lng, vehicle.id, disableAnimation, vehicle.status, vehicle.heading]);

  // Dead reckoning: extrapolate position when GPS update is delayed
  useEffect(() => {
    const maxDrMs = maxDeadReckonTime(vehicle.speed ?? 0);
    if (maxDrMs <= 0) return;

    const interval = setInterval(() => {
      const marker = markerRef.current;
      if (!marker) return;

      const elapsed = Date.now() - lastUpdateRef.current;
      if (elapsed < 1000) return; // Only predict after 1s without update
      if (elapsed > maxDrMs) return; // Stop predicting beyond limit

      const state = lastStateRef.current;
      if (!state || state.speed <= 0) return;

      const predicted = predictPosition(
        { ...state, timestamp: lastUpdateRef.current },
        Date.now(),
      );

      marker.setLatLng([predicted.lat, predicted.lng]);
    }, 200);

    return () => clearInterval(interval);
  }, [vehicle.speed]);

  const popupContent = useMemo(() => {
    const container = document.createElement('div');
    container.style.minWidth = '220px';

    const emojiRow = document.createElement('div');
    emojiRow.style.fontSize = '1.5rem';
    emojiRow.style.marginBottom = '6px';
    emojiRow.textContent = `${EMOJI} ${vehicle.name}`;
    container.appendChild(emojiRow);

    const coords = document.createElement('div');
    coords.style.fontSize = '0.65rem';
    coords.style.fontFamily = 'var(--font-mono, monospace)';
    coords.style.color = 'var(--color-text-tertiary, #7A8BA3)';
    coords.style.marginBottom = '6px';
    coords.textContent = `${vehicle.lat.toFixed(6)}, ${vehicle.lng.toFixed(6)}`;
    container.appendChild(coords);

    const detail = document.createElement('div');
    detail.style.display = 'flex';
    detail.style.flexDirection = 'column';
    detail.style.gap = '2px';
    detail.style.marginBottom = '6px';

    if (vehicle.speed !== undefined) {
      const speedKmh = (vehicle.speed * 3.6).toFixed(1);
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.innerHTML = `⚡ ${speedKmh} km/h`;
      detail.appendChild(row);
    }

    if (vehicle.accuracy !== undefined) {
      const row = document.createElement('div');
      row.style.fontSize = '0.7rem';
      row.style.color = 'var(--color-text-tertiary, #7A8BA3)';
      row.innerHTML = `🎯 ±${Math.round(vehicle.accuracy)}m`;
      detail.appendChild(row);
    }

    if (vehicle.heading !== undefined) {
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.innerHTML = `🧭 ${vehicle.heading.toFixed(0)}°`;
      detail.appendChild(row);
    }

    if (vehicle.routeDistance && vehicle.routeDistance > 0) {
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.innerHTML = `🛣️ ${formatDistance(vehicle.routeDistance)}`;
      detail.appendChild(row);
    }

    if (vehicle.eta) {
      const row = document.createElement('div');
      row.style.fontSize = '0.7rem';
      row.style.color = 'var(--color-status-moving, #F2A93C)';
      row.style.fontFamily = 'var(--font-mono, monospace)';
      row.innerHTML = `🕐 ETA: ${vehicle.eta}`;
      detail.appendChild(row);
    }

    container.appendChild(detail);

    const timeRow = document.createElement('div');
    timeRow.style.fontSize = '0.7rem';
    timeRow.style.color = 'var(--color-text-tertiary, #7A8BA3)';
    timeRow.style.marginBottom = '6px';
    const ts = new Date(vehicle.timestamp);
    timeRow.innerHTML = `📡 ${formatDate(ts)} ${formatTime(ts)}`;
    container.appendChild(timeRow);

    const badge = document.createElement('div');
    badge.style.display = 'inline-block';
    badge.style.padding = '2px 10px';
    badge.style.borderRadius = '12px';
    badge.style.fontSize = '0.65rem';
    badge.style.fontWeight = '700';
    badge.style.textTransform = 'uppercase';
    badge.style.letterSpacing = '0.04em';
    if (vehicle.status === 'moving') {
      badge.style.background = 'rgba(242,169,60,0.15)';
      badge.style.color = 'var(--color-status-moving, #F2A93C)';
      badge.style.border = '1px solid rgba(242,169,60,0.3)';
      badge.textContent = '🟡 EN MOUVEMENT';
    } else {
      badge.style.background = 'rgba(63,167,150,0.12)';
      badge.style.color = 'var(--color-status-static, #3FA796)';
      badge.style.border = '1px solid rgba(63,167,150,0.25)';
      badge.textContent = '🟢 À L\'ARRÊT';
    }
    container.appendChild(badge);

    return container;
  }, [vehicle]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    const popup = marker.getPopup();
    if (popup && marker.isPopupOpen()) {
      popup.setContent(popupContent);
    }
    marker.unbindPopup();
    marker.bindPopup(popupContent);
  }, [popupContent]);

  return null;
}

function MapBoundsUpdater({ positions }: { positions: { latitude: number; longitude: number }[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (positions.length > 0 && !fitted.current) {
      const bounds = L.latLngBounds(positions.map((p) => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [50, 50] });
      fitted.current = true;
    }
  }, [positions, map]);
  return null;
}

function MapFlyToDriver({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef({ lat: 0, lng: 0 });

  useEffect(() => {
    if (prevRef.current.lat === lat && prevRef.current.lng === lng) return;
    prevRef.current = { lat, lng };
    map.flyTo([lat, lng], 16, { duration: 0.8 });
  }, [lat, lng, map]);

  return null;
}

function DetailRow({ label, value, color, mono }: { label: string; value: string; color?: string; mono?: boolean }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={`${styles.detailValue}${mono ? ` ${styles.detailValueMono}` : ''}`} style={{ color: color || 'var(--color-text)' }}>{value}</span>
    </div>
  );
}

function MapFocusHandler({ focusId, focusCenter, vehicles }: { focusId?: string | null; focusCenter?: { lat: number; lng: number } | null; vehicles: VehicleData[] }) {
  const map = useMap();
  const lastFocus = useRef<string | null>(null);

  useEffect(() => {
    if (focusCenter) {
      map.flyTo([focusCenter.lat, focusCenter.lng], 15, { duration: 0.8 });
    }
  }, [focusCenter, map]);

  useEffect(() => {
    if (!focusId || focusId === lastFocus.current) return;
    lastFocus.current = focusId;
    const vehicle = vehicles.find((v) => v.id === focusId);
    if (vehicle) {
      setTimeout(() => {
        map.eachLayer((layer: Layer) => {
          if (layer instanceof L.Marker && Math.abs(layer.getLatLng().lat - vehicle.lat) < 0.001 && Math.abs(layer.getLatLng().lng - vehicle.lng) < 0.001) {
            layer.openPopup();
          }
        });
      }, 900);
    }
  }, [focusId, vehicles, map]);

  return null;
}

function MapStyleOverrider() {
  const map = useMap();
  useEffect(() => {
    map.getContainer().style.background = 'var(--color-bg, #0B1220)';
  }, [map]);
  return null;
}

function DestinationMarker({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    const icon = L.divIcon({
      className: 'dt-destination-marker',
      html: `<div></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    return () => { map.removeLayer(marker); };
  }, [lat, lng, map]);

  return null;
}

interface RealTimeMapProps {
  deliveryId?: string;
  readOnly?: boolean;
  initialPositions?: { latitude: number; longitude: number }[];
  fullscreen?: boolean;
  deliveryLat?: number;
  deliveryLng?: number;
  focusId?: string | null;
  focusCenter?: { lat: number; lng: number } | null;
  onVehiclesUpdate?: (vehicles: VehicleData[]) => void;
}

export default function RealTimeMap({ deliveryId, readOnly, initialPositions, deliveryLat, deliveryLng, focusId, focusCenter, onVehiclesUpdate }: RealTimeMapProps) {
  const [vehicles, setVehicles] = useState<Map<string, VehicleData>>(new Map());
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [routingPolyline, setRoutingPolyline] = useState<[number, number][]>([]);
  const [routingETA, setRoutingETA] = useState<string | null>(null);
  const [routingDistance, setRoutingDistance] = useState<number>(0);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [driverFilter, setDriverFilter] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<VehicleData | null>(null);
  const devPerf = useDevicePerformance();

  const { data: driversData } = useQuery({
    queryKey: ['drivers', 'list'],
    queryFn: () => api.get('/drivers?limit=100').then((r: { data: unknown }) =>
      ((r.data as { data?: { id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { licensePlate: string } }[] })?.data ?? r.data ?? []) as { id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { licensePlate: string } }[]
    ),
    staleTime: 60_000,
  });

  const { data: livePositions } = useQuery({
    queryKey: ['tracking', 'live'],
    queryFn: () => api.get('/tracking/live').then((r: { data: unknown }) =>
      (r.data ?? r ?? []) as (PositionUpdate & { minutesAgo?: number })[]
    ),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const allDrivers: Array<{ id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { licensePlate: string } }> = driversData ?? [];

  const lastRouteCalcPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteCalcTime = useRef<number>(0);
  const routingLoadingRef = useRef(false);
  const routeCalcIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deliveryLatRef = useRef(deliveryLat);
  const deliveryLngRef = useRef(deliveryLng);
  deliveryLatRef.current = deliveryLat;
  deliveryLngRef.current = deliveryLng;
  const setRoutingPolylineRef = useRef(setRoutingPolyline);
  const setRoutingETARef = useRef(setRoutingETA);
  const setRoutingDistanceRef = useRef(setRoutingDistance);
  const setRoutingLoadingRef = useRef(setRoutingLoading);
  setRoutingPolylineRef.current = setRoutingPolyline;
  setRoutingETARef.current = setRoutingETA;
  setRoutingDistanceRef.current = setRoutingDistance;
  setRoutingLoadingRef.current = setRoutingLoading;

  const allPositions = Array.from(vehicles.values());
  const searchResults = useMemo(() => {
    if (!driverFilter.trim()) return [];
    const q = driverFilter.toLowerCase();
    const active = allPositions.filter((v) => v.name.toLowerCase().includes(q));
    const activeIds = new Set(active.map((v) => v.id));
    const offline = allDrivers
      .filter((d) => !activeIds.has(d.id) && `${d.firstName} ${d.lastName}`.toLowerCase().includes(q))
      .map((d) => ({
        id: d.id,
        lat: 0,
        lng: 0,
        name: `${d.firstName} ${d.lastName}`,
        status: 'offline' as const,
        timestamp: new Date().toISOString(),
        vehiclePlate: d.vehicle?.licensePlate,
        licenseNumber: d.licenseNumber,
      }));
    return [...active.map((v) => ({ ...v, isOffline: false })), ...offline.map((v) => ({ ...v, isOffline: true }))];
  }, [allPositions, allDrivers, driverFilter]);

  const filteredVehicles = useMemo(() => {
    if (!driverFilter.trim()) return allPositions;
    const q = driverFilter.toLowerCase();
    return allPositions.filter((v) => v.name.toLowerCase().includes(q));
  }, [allPositions, driverFilter]);
  const visibleVehicles = useMemo(() => {
    if (filteredVehicles.length <= devPerf.maxAnimatedMarkers) return filteredVehicles;
    return filteredVehicles.slice(0, devPerf.maxAnimatedMarkers);
  }, [filteredVehicles, devPerf.maxAnimatedMarkers]);

  const recalcRoute = useCallback(async (lat: number, lng: number) => {
    const dLat = deliveryLatRef.current;
    const dLng = deliveryLngRef.current;
    if (!dLat || !dLng || routingLoadingRef.current) return;

    routingLoadingRef.current = true;
    setRoutingLoadingRef.current(true);
    try {
      const result = await getDirections({
        originLat: lat,
        originLng: lng,
        destinationLat: dLat,
        destinationLng: dLng,
        profile: 'driving',
      });
      setRoutingPolylineRef.current(result.polyline);
      setRoutingDistanceRef.current(result.distance);
      const etaSec = result.duration;
      if (etaSec > 0) {
        const hours = Math.floor(etaSec / 3600);
        const minutes = Math.floor((etaSec % 3600) / 60);
        setRoutingETARef.current(hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`);
      }
      lastRouteCalcPos.current = { lat, lng };
      lastRouteCalcTime.current = Date.now();
    } catch {
      setRoutingPolylineRef.current([]);
      setRoutingETARef.current(null);
      setRoutingDistanceRef.current(0);
    } finally {
      routingLoadingRef.current = false;
      setRoutingLoadingRef.current(false);
    }
  }, []);

  const computeETAForVehicle = useCallback((update: PositionUpdate): string | null => {
    const dLat = deliveryLatRef.current;
    const dLng = deliveryLngRef.current;
    if (!dLat || !dLng || update.speed === undefined || update.speed <= 0) return null;
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLatR = toRad(dLat - update.latitude);
    const dLon = toRad(dLng - update.longitude);
    const a =
      Math.sin(dLatR / 2) ** 2 +
      Math.cos(toRad(update.latitude)) * Math.cos(toRad(dLat)) * Math.sin(dLon / 2) ** 2;
    const distanceM = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const speedMs = update.speed;
    const etaSec = speedMs > 0 ? distanceM / speedMs : Infinity;
    if (etaSec > 86400) return null;
    const hours = Math.floor(etaSec / 3600);
    const minutes = Math.floor((etaSec % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}min`;
    return `${minutes}min`;
  }, []);

  // Bootstrap vehicles from REST live positions (before any WebSocket update)
  useEffect(() => {
    if (!livePositions || !Array.isArray(livePositions) || livePositions.length === 0) return;
    const OFFLINE_TIMEOUT_MIN = 15;
    setVehicles((prev) => {
      const next = new Map(prev);
      for (const pos of livePositions) {
        if (!next.has(pos.driverId)) {
          const minutesOld = pos.minutesAgo ?? 0;
          const isOffline = minutesOld > OFFLINE_TIMEOUT_MIN;
          const eta = computeETAForVehicle(pos);
          next.set(pos.driverId, {
            id: pos.driverId,
            lat: pos.latitude,
            lng: pos.longitude,
            name: pos.driverName,
            speed: pos.speed ?? undefined,
            heading: pos.heading ?? undefined,
            accuracy: pos.accuracy ?? undefined,
            vehicleId: pos.vehicleId,
            deliveryId: pos.deliveryId ?? undefined,
            confidence: pos.accuracy ? Math.max(0.1, 1 - pos.accuracy / 50) : 1,
            timestamp: pos.timestamp,
            status: isOffline ? 'offline' as const : pos.speed && pos.speed > 0.5 ? 'moving' as const : 'static' as const,
            eta,
          });
        }
      }
      return next;
    });
  }, [livePositions, computeETAForVehicle]);

  const addPosition = useCallback((update: PositionUpdate) => {
    const eta = computeETAForVehicle(update);
    const dLat = deliveryLatRef.current;
    const dLng = deliveryLngRef.current;

    setVehicles((prev) => {
      const next = new Map(prev);
      next.set(update.driverId, {
        id: update.driverId,
        lat: update.latitude,
        lng: update.longitude,
        name: update.driverName,
        speed: update.speed,
        heading: update.heading,
        accuracy: update.accuracy,
        vehicleId: update.vehicleId,
        deliveryId: update.deliveryId,
        confidence: update.confidence ?? (update.accuracy ? Math.max(0.1, 1 - update.accuracy / 50) : 1),
        timestamp: update.timestamp,
        status: update.speed && update.speed > 0.5 ? 'moving' : 'static',
        eta,
      });
      return next;
    });

    if (deliveryId && update.deliveryId === deliveryId && dLat && dLng) {
      setRoutePath((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last[0] !== update.latitude || last[1] !== update.longitude) {
          return [...prev, [update.latitude, update.longitude] as [number, number]];
        }
        return prev;
      });

      if (update.speed && update.speed > 0) {
        const now = Date.now();
        if (now - lastRouteCalcTime.current >= ROUTE_RECALC_MIN_DELAY_MS) {
          const lastPos = lastRouteCalcPos.current;
          if (!lastPos || haversineDistance(lastPos.lat, lastPos.lng, update.latitude, update.longitude) >= ROUTE_RECALC_MIN_DISTANCE_M) {
            recalcRoute(update.latitude, update.longitude);
          }
        }
      }
    }
  }, [deliveryId, computeETAForVehicle, recalcRoute]);

  useEffect(() => {
    if (readOnly) return;
    const socket = getSocket();

    if (deliveryId) {
      socket.emit('subscribeToDelivery', deliveryId);
    } else {
      socket.emit('subscribeToCompany');
    }

    socket.on('positionUpdate', addPosition);
    socket.on('batchPositionUpdate', (updates: PositionUpdate[]) => {
      updates.forEach((u) => addPosition(u));
    });

    return () => {
      if (deliveryId) {
        socket.emit('unsubscribeFromDelivery', deliveryId);
      } else {
        socket.emit('unsubscribeFromCompany');
      }
      socket.off('positionUpdate', addPosition);
      socket.off('batchPositionUpdate');
    };
  }, [addPosition, deliveryId, readOnly]);

  useEffect(() => {
    if (initialPositions && initialPositions.length > 0) {
      setRoutePath(initialPositions.map((p) => [p.latitude, p.longitude] as [number, number]));
    }
  }, [initialPositions]);

  useEffect(() => {
    onVehiclesUpdate?.(allPositions);
  }, [allPositions, onVehiclesUpdate]);

  useEffect(() => {
    if (deliveryLat && deliveryLng && allPositions.length > 0) {
      const driver = allPositions[0];
      recalcRoute(driver.lat, driver.lng);
    }
  }, [deliveryLat, deliveryLng]);

  useEffect(() => {
    if (!deliveryLat || !deliveryLng) return;

    routeCalcIntervalRef.current = setInterval(() => {
      if (allPositions.length > 0) {
        const driver = allPositions[0];
        if (driver.speed && driver.speed > 0) {
          const now = Date.now();
          if (now - lastRouteCalcTime.current >= ROUTE_RECALC_MIN_DELAY_MS) {
            recalcRoute(driver.lat, driver.lng);
          }
        }
      }
    }, ROUTE_RECALC_INTERVAL_MS);

    return () => {
      if (routeCalcIntervalRef.current) {
        clearInterval(routeCalcIntervalRef.current);
      }
    };
  }, [deliveryLat, deliveryLng, allPositions, recalcRoute]);

  const center: [number, number] = allPositions.length > 0
    ? [allPositions[0].lat, allPositions[0].lng]
    : [-18.8792, 47.5079];

  const exceededMarkerLimit = allPositions.length > devPerf.maxAnimatedMarkers;
  const hasDeliveryDestination = deliveryLat !== undefined && deliveryLng !== undefined;

  return (
    <MapContainer
      center={center}
      zoom={13}
      className={styles.mapContainer}
      zoomControl={true}
    >
      <MapStyleOverrider />
      <MapLayerSwitcher />
      <MapFocusHandler focusId={focusId} focusCenter={focusCenter} vehicles={allPositions} />

      <div style={{
        position: 'absolute', top: 10, left: 50, zIndex: 1000,
      }}>
        <div className={styles.searchBar}>
          <Search size={14} className={styles.searchIcon} />
          <input
            placeholder="Rechercher un chauffeur…"
            value={driverFilter}
            onChange={(e) => setDriverFilter(e.target.value)}
            className={styles.searchInput}
          />
          {driverFilter && (
            <button
              onClick={() => { setDriverFilter(''); setSelectedDriver(null); }}
              className={styles.searchClearButton}
            >
              <X size={14} />
            </button>
          )}
        </div>
        {driverFilter && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
          }} className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <div className={styles.searchResultEmpty}>
                Aucun résultat
              </div>
            ) : (
              searchResults.map((v: SearchResult) => (
                <div
                  key={v.id}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!v.isOffline) {
                      setSelectedDriver(v as VehicleData);
                    }
                    setDriverFilter('');
                  }}
                  className={`${styles.searchResultItem}${v.isOffline ? ` ${styles.searchResultItemOffline}` : ''}`}
                >
                  <span className={styles.searchResultIcon}>{v.isOffline ? '⏸️' : '🚗'}</span>
                  <div>
                    <div className={styles.searchResultName}>{v.name}</div>
                    <div className={styles.searchResultSub}>
                      {v.isOffline || v.status === 'offline'
                        ? 'Hors ligne — aucune position récente'
                        : `${v.status === 'moving' ? 'En route' : 'À l\'arrêt'} · ${v.accuracy !== undefined ? `±${Math.round(v.accuracy)}m · ` : ''}${formatTime(v.timestamp ?? '')}`
                      }
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      <MapBoundsUpdater positions={allPositions.map((v) => ({ latitude: v.lat, longitude: v.lng }))} />

      {selectedDriver && (
        <>
          <MapFlyToDriver lat={selectedDriver.lat} lng={selectedDriver.lng} />
          <div style={{
            position: 'absolute', bottom: 20, right: 10, zIndex: 1000,
          }} className={styles.driverCard}>
            <div className={styles.driverCardHeader}>
              <div className={styles.driverCardTitle}>🚗 {selectedDriver.name}</div>
              <button
                onClick={() => setSelectedDriver(null)}
                className={styles.driverCardClose}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.driverCardBody}>
              <DetailRow label="Statut" value={selectedDriver.status === 'moving' ? 'En mouvement' : 'À l\'arrêt'} color={selectedDriver.status === 'moving' ? 'var(--color-accent)' : 'var(--color-teal)'} />
              {selectedDriver.speed !== undefined && (
                <DetailRow label="Vitesse" value={`${(selectedDriver.speed * 3.6).toFixed(1)} km/h`} />
              )}
              {selectedDriver.heading !== undefined && (
                <DetailRow label="Direction" value={`${selectedDriver.heading.toFixed(0)}°`} />
              )}
              <DetailRow label="Position" value={`${selectedDriver.lat.toFixed(5)}, ${selectedDriver.lng.toFixed(5)}`} mono />
              {selectedDriver.accuracy !== undefined && (
                <DetailRow label="Précision GPS" value={`±${Math.round(selectedDriver.accuracy)}m`} />
              )}
              {selectedDriver.confidence !== undefined && (
                <DetailRow label="Confiance Kalman" value={`${(selectedDriver.confidence * 100).toFixed(0)}%`} />
              )}
              <DetailRow label="Dernière position" value={formatTime(selectedDriver.timestamp)} />
              <DetailRow label="Date" value={formatDate(selectedDriver.timestamp)} />
              {selectedDriver.eta && (
                <DetailRow label="ETA destination" value={selectedDriver.eta} color="var(--color-teal)" />
              )}
              {selectedDriver.vehicleId && (
                <DetailRow label="Véhicule ID" value={selectedDriver.vehicleId.slice(0, 8)} mono />
              )}
              {selectedDriver.deliveryId && (
                <DetailRow label="Livraison ID" value={selectedDriver.deliveryId.slice(0, 8)} mono />
              )}
              {!selectedDriver.deliveryId && (
                <DetailRow label="Statut" value="Disponible" color="var(--color-teal)" />
              )}
              {selectedDriver.routeDistance !== undefined && (
                <DetailRow label="Distance restante" value={formatDistance(selectedDriver.routeDistance)} />
              )}
            </div>

            {(!selectedDriver.timestamp || Date.now() - new Date(selectedDriver.timestamp).getTime() > 120_000) && (
              <div className={styles.warningBanner}>
                ⚠️ Position non actualisée depuis plus de 2 minutes
              </div>
            )}
          </div>
        </>
      )}

      {routePath.length > 1 && (
        <Polyline
          positions={routePath}
          color="var(--color-accent, #F2A93C)"
          weight={3}
          opacity={0.5}
          dashArray="8 4"
        />
      )}

      {routingPolyline.length > 1 && (
        <Polyline
          positions={routingPolyline}
          color="var(--color-teal, #3FA796)"
          weight={4}
          opacity={0.8}
        />
      )}

      {hasDeliveryDestination && (
        <DestinationMarker lat={deliveryLat!} lng={deliveryLng!} />
      )}

      {routingETA && hasDeliveryDestination && (
        <div style={{
          position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000,
        }} className={styles.etaBanner}>
          <span className={styles.etaText}>
            🕐 ETA: {routingETA}
          </span>
          <span className={styles.etaDistance}>
            🛣️ {formatDistance(routingDistance)}
          </span>
          {routingLoading && (
            <span className={styles.etaLoading}>
              ↻
            </span>
          )}
        </div>
      )}

      {exceededMarkerLimit && (
        <div style={{
          position: 'absolute', top: 8, left: 8, zIndex: 1000,
        }} className={styles.markerLimitNotice}>
          {allPositions.length} véhicules — affichage limité à {devPerf.maxAnimatedMarkers}
        </div>
      )}

      {visibleVehicles.length === 0 && (
        <div style={{
          position: 'absolute', bottom: 110, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1000,
        }} className={styles.emptyState}>
          Aucun véhicule actif — {allPositions.length} reçue(s)
        </div>
      )}
      {visibleVehicles.map((v) => (
        <AnimatedMarker key={v.id} vehicle={v} disableAnimation={!devPerf.enableAnimations} focused={focusId === v.id} />
      ))}
    </MapContainer>
  );
}