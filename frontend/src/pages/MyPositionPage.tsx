import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import MapLayerSwitcher from '../components/MapLayerSwitcher';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../services/api/client';
import { formatDate } from '../services/i18n/formatDate';
import { getSocket } from '../services/socket/socket';
import { enqueuePosition, dequeueAllPositions, clearQueue, queueSize } from '../services/offlineQueue';
import LocationSearchInput from '../components/LocationSearchInput';
import { getDirections, formatDistance, formatDuration } from '../services/routing/routingService';
import { getDestinationHistory, addDestinationHistory } from '../services/routing/destinationHistory';
import NavigationOverlay from '../features/navigation/NavigationOverlay';
import type { Delivery } from '../types';
import Button from '../components/Button';
import type { RouteStep, RouteData } from '../services/routing/types';
import { KalmanFilter } from '../services/tracking/KalmanFilter';
import { sensorFusion, simulateStationaryFromSpeed } from '../services/tracking/sensorFusion';
import styles from './MyPositionPage.module.css';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] });
L.Marker.prototype.options.icon = DefaultIcon;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ACCURACY_GOOD = 10;
const ACCURACY_MODERATE = 30;
const ACCURACY_POOR = 50;
const ACCURACY_REJECT = 80;
const SPEED_MOVING_THRESHOLD_MS = 1.39;
const STOPPED_DURATION_MS = 30_000;
const INTERVAL_FAST = 3000;
const INTERVAL_SLOW = 20000;
const INTERVAL_DEFAULT = 5000;
const INTERVAL_DATA_SAVER = 10000;
const DRAIN_INTERVAL_MS = 10000;
const ROUTE_RECALC_MIN_DISTANCE_M = 200;
const ROUTE_RECALC_MIN_DELAY_MS = 15000;
const ROUTE_RECALC_INTERVAL_MS = 30000;

interface DriverProfile {
  id: string;
  firstName: string;
  lastName: string;
  vehicle?: { id: string; brand: string; model: string; licensePlate: string };
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

function MapFollowPosition({ lat, lng, enabled }: { lat: number; lng: number; enabled: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled) return;
    map.setView([lat, lng], 16, { animate: true });
  }, [lat, lng, enabled, map]);
  return null;
}

export default function MyPositionPage() {
  const { t } = useTranslation();
  const [tracking, setTracking] = useState(false);
  const [startingTracking, setStartingTracking] = useState(false);
  const [position, setPosition] = useState<{
    lat: number; lng: number; speed?: number; heading?: number;
    altitude?: number; accuracy?: number;
  } | null>(null);
  const [selectedDelivery, setSelectedDelivery] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [queueCount, setQueueCount] = useState(0);
  const [poorAccuracy, setPoorAccuracy] = useState(false);
  const [confidenceLevel, setConfidenceLevel] = useState(1);
  const [sensorAvailable, setSensorAvailable] = useState(false);
  const [isStationary, setIsStationary] = useState(false);

  const kalmanRef = useRef<KalmanFilter | null>(null);
  const filteredPosRef = useRef<{ lat: number; lng: number; confidence: number } | null>(null);
  const stationaryOverrideRef = useRef(false);

  const [routingPolyline, setRoutingPolyline] = useState<[number, number][]>([]);
  const [routingSteps, setRoutingSteps] = useState<RouteStep[]>([]);
  const [routingETA, setRoutingETA] = useState<string | null>(null);
  const [routingDistance, setRoutingDistance] = useState(0);
  const [routingDuration, setRoutingDuration] = useState(0);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [navigationMode, setNavigationMode] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [plannedRoute, setPlannedRoute] = useState<[number, number][]>([]);

  const [routeAlternatives, setRouteAlternatives] = useState<RouteData[] | null>(null);
  const [, setSelectedRouteIdx] = useState(0);

  const watchRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMovingRef = useRef<number>(Date.now());
  const intervalDurationRef = useRef<number>(INTERVAL_DEFAULT);
  const posRef = useRef(position);
  const isSendingRef = useRef(false);
  const lastRouteCalcPos = useRef<{ lat: number; lng: number } | null>(null);
  const lastRouteCalcTime = useRef<number>(0);
  const routeCalcIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const routingLoadingRef = useRef(false);
  const dataSaverRef = useRef(false);
  posRef.current = position;
  dataSaverRef.current = dataSaver;

  const { data: profile } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api.get('/drivers/profile').then((r) => r.data),
  });

  const { data: deliveriesData } = useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => api.get('/deliveries/my-deliveries').then((r) => r.data),
  });

  const driver = profile as DriverProfile | undefined;
  const deliveries: Delivery[] = deliveriesData?.data ?? [];
  const vehicleId = driver?.vehicle?.id || '';
  const driverName = driver ? `${driver.firstName} ${driver.lastName}` : '';
  const destinationHistory = getDestinationHistory();

  const [destination, setDestination] = useState<{ lat: number | null; lng: number | null; label: string }>({ lat: null, lng: null, label: '' });

  const activeDelivery = useMemo(() => {
    if (!selectedDelivery) return null;
    return deliveries.find((d) => d.id === selectedDelivery) || null;
  }, [deliveries, selectedDelivery]);

  useEffect(() => {
    if (activeDelivery && activeDelivery.deliveryAddress) {
      setDestination({
        lat: activeDelivery.deliveryLat ?? null,
        lng: activeDelivery.deliveryLng ?? null,
        label: activeDelivery.deliveryAddress,
      });
      if (activeDelivery.pickupLat && activeDelivery.pickupLng && activeDelivery.deliveryLat && activeDelivery.deliveryLng) {
        getDirections({
          originLat: activeDelivery.pickupLat,
          originLng: activeDelivery.pickupLng,
          destinationLat: activeDelivery.deliveryLat,
          destinationLng: activeDelivery.deliveryLng,
          profile: 'driving',
          alternatives: false,
        }).then((r) => setPlannedRoute(r.polyline)).catch(() => setPlannedRoute([]));
      } else {
        setPlannedRoute([]);
      }
    } else {
      setDestination({ lat: null, lng: null, label: '' });
      setPlannedRoute([]);
    }
  }, [activeDelivery]);

  const applyRouteData = useCallback((data: RouteData) => {
    setRoutingPolyline(data.polyline);
    setRoutingSteps(data.steps);
    setRoutingDistance(data.distance);
    setRoutingDuration(data.duration);
    const etaSec = data.duration;
    if (etaSec > 0) {
      const hours = Math.floor(etaSec / 3600);
      const minutes = Math.floor((etaSec % 3600) / 60);
      setRoutingETA(hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`);
    }
  }, []);

  const selectRoute = useCallback((idx: number, data: RouteData) => {
    setSelectedRouteIdx(idx);
    applyRouteData(data);
  }, [applyRouteData]);

  const shouldRecalcRoute = useCallback((lat: number, lng: number): boolean => {
    if (dataSaverRef.current) return false;
    const now = Date.now();
    if (now - lastRouteCalcTime.current < ROUTE_RECALC_MIN_DELAY_MS) return false;
    if (!lastRouteCalcPos.current) return true;
    const dist = haversineDistance(
      lastRouteCalcPos.current.lat, lastRouteCalcPos.current.lng,
      lat, lng,
    );
    return dist >= ROUTE_RECALC_MIN_DISTANCE_M;
  }, []);

  const recalcRoute = useCallback(async (lat: number, lng: number, withAlternatives = false) => {
    const dLat = destination.lat;
    const dLng = destination.lng;
    if (dLat == null || dLng == null || routingLoadingRef.current) return;

    routingLoadingRef.current = true;
    setRoutingLoading(true);
    try {
      const result = await getDirections({
        originLat: lat,
        originLng: lng,
        destinationLat: dLat,
        destinationLng: dLng,
        profile: 'driving',
        alternatives: withAlternatives,
      });
      if (withAlternatives && result.alternatives && result.alternatives.length > 0) {
        setRouteAlternatives(result.alternatives);
        setSelectedRouteIdx(0);
      } else {
        setRouteAlternatives(null);
      }
      applyRouteData(result);
      lastRouteCalcPos.current = { lat, lng };
      lastRouteCalcTime.current = Date.now();
    } catch {
      setRoutingPolyline([]);
      setRoutingSteps([]);
      setRoutingETA(null);
      setRoutingDistance(0);
      setRoutingDuration(0);
      setRouteAlternatives(null);
    } finally {
      routingLoadingRef.current = false;
      setRoutingLoading(false);
    }
  }, [destination.lat, destination.lng, applyRouteData]);

  const refreshQueueCount = useCallback(async () => {
    const count = await queueSize();
    setQueueCount(count);
  }, []);

  const drainQueue = useCallback(async () => {
    const socket = getSocket();
    if (!socket.connected) return;
    const positions = await dequeueAllPositions();
    if (positions.length === 0) return;
    try {
      socket.emit('batchPosition', { positions }, (ack: { event?: string }) => {
        if (ack && ack.event === 'positionsSaved') {
          clearQueue().then(() => refreshQueueCount());
        }
      });
    } catch {}
  }, [refreshQueueCount]);

  const sendPosition = useCallback(() => {
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    const p = posRef.current;
    const filtered = filteredPosRef.current;
    const dId = selectedDelivery;
    const vId = vehicleId;
    if (!p || !dId) { isSendingRef.current = false; return; }
    if (!vId) { setStatusMsg(t('myPosition.noVehicleAssigned')); isSendingRef.current = false; return; }

    // Graduated accuracy filter:
    // - ACCURACY_GOOD (10m): full confidence, always send
    // - ACCURACY_MODERATE (30m): send with confidence tag
    // - ACCURACY_POOR (50m): send but mark as low confidence
    // - ACCURACY_REJECT (80m): reject unless we have no better data
    const acc = p.accuracy ?? 50;
    if (acc >= ACCURACY_REJECT) {
      setPoorAccuracy(true);
      isSendingRef.current = false;
      return;
    }
    setPoorAccuracy(acc > ACCURACY_MODERATE);

    const sendLat = filtered ? filtered.lat : p.lat;
    const sendLng = filtered ? filtered.lng : p.lng;
    const confidence = filtered ? filtered.confidence : 1;

    const now = new Date().toISOString();
    const payload: Record<string, unknown> & { event: string } = {
      event: 'updatePosition',
      latitude: sendLat, longitude: sendLng,
      speed: p.speed ?? undefined, heading: p.heading,
      altitude: p.altitude, accuracy: acc,
      confidence,
      timestamp: now, deliveryId: dId, vehicleId: vId,
    };
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('updatePosition', payload, () => { isSendingRef.current = false; });
      setTimeout(() => { isSendingRef.current = false; }, 2000);
    } else {
      enqueuePosition(payload).then(() => { refreshQueueCount(); isSendingRef.current = false; });
    }
  }, [selectedDelivery, vehicleId, refreshQueueCount]);

  const recalcInterval = useCallback((speed: number | undefined, accuracy?: number, stationary?: boolean) => {
    const now = Date.now();
    if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) lastMovingRef.current = now;
    let ni: number;
    const isStationary = stationary === true || (speed !== undefined && speed < 0.1);

    if (dataSaverRef.current) {
      ni = INTERVAL_DATA_SAVER;
    } else if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) {
      // Moving: faster refresh for smoother tracking
      ni = accuracy !== undefined && accuracy > ACCURACY_MODERATE && accuracy < ACCURACY_REJECT
        ? INTERVAL_FAST // Poor accuracy while moving: sample more for Kalman filter to converge
        : INTERVAL_FAST;
    } else if (isStationary && (now - lastMovingRef.current > STOPPED_DURATION_MS)) {
      // Stationary > 30s: slow down — the Kalman filter already locks position with near-zero velocity
      ni = INTERVAL_SLOW;
    } else {
      ni = INTERVAL_DEFAULT;
    }
    if (ni !== intervalDurationRef.current) {
      intervalDurationRef.current = ni;
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(sendPosition, ni);
    }
  }, [sendPosition]);

  const startRoutingRecalc = useCallback(() => {
    if (routeCalcIntervalRef.current) clearInterval(routeCalcIntervalRef.current);
    routeCalcIntervalRef.current = setInterval(() => {
      if (dataSaverRef.current) return;
      const p = posRef.current;
      if (p && destination.lat != null && destination.lng != null && p.speed != null && p.speed > 0) {
        if (shouldRecalcRoute(p.lat, p.lng)) recalcRoute(p.lat, p.lng);
      }
    }, ROUTE_RECALC_INTERVAL_MS);
  }, [destination.lat, destination.lng, shouldRecalcRoute, recalcRoute]);

  const stopRoutingRecalc = useCallback(() => {
    if (routeCalcIntervalRef.current) { clearInterval(routeCalcIntervalRef.current); routeCalcIntervalRef.current = null; }
  }, []);

  const onRecalcRouteFromNav = useCallback((lat: number, lng: number) => {
    if (dataSaver) return;
    recalcRoute(lat, lng);
  }, [recalcRoute, dataSaver]);

  const startTracking = () => {
    if (!navigator.geolocation) { setStatusMsg(t('myPosition.geoNotSupported')); return; }
    if (!selectedDelivery) { setStatusMsg(t('myPosition.selectDelivery')); return; }
    if (!vehicleId) { setStatusMsg(t('myPosition.noVehicleAssigned')); return; }

    setStartingTracking(true);
    setTracking(true);
    setStatusMsg(t('myPosition.searchingPosition'));
    setPoorAccuracy(false);
    setConfidenceLevel(1);

    sensorFusion.init().then((avail) => setSensorAvailable(avail)).catch(() => {});

    kalmanRef.current = null;
    filteredPosRef.current = null;

    let triedLowAccuracy = false;

    const tryWatch = (highAccuracy: boolean) => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setStartingTracking(false);
          const { latitude, longitude, speed, heading, altitude, accuracy } = pos.coords;
          const acc = accuracy ?? 50;

        if (!kalmanRef.current) {
          kalmanRef.current = new KalmanFilter(latitude, longitude, acc);
          kalmanRef.current.predict();
        }
        kalmanRef.current.predict();
        const filtered = kalmanRef.current.update(latitude, longitude, acc);
        const conf = kalmanRef.current.getConfidence();

        const stationaryFromSensor = sensorFusion.isStationary();
        const stationaryFromSpeed = simulateStationaryFromSpeed(speed ?? undefined);
        const isActuallyStationary = stationaryFromSensor === null
          ? stationaryFromSpeed
          : stationaryFromSensor;
        stationaryOverrideRef.current = isActuallyStationary;

        filteredPosRef.current = { lat: filtered.lat, lng: filtered.lng, confidence: conf };

        const p = {
          lat: filtered.lat,
          lng: filtered.lng,
          speed: speed ?? undefined,
          heading: heading ?? undefined,
          altitude: altitude ?? undefined,
          accuracy: acc,
        };
        setPosition(p);
        setConfidenceLevel(conf);
        setIsStationary(isActuallyStationary);
        recalcInterval(speed ?? undefined, acc, isActuallyStationary);

        if (acc <= ACCURACY_GOOD) {
          setStatusMsg(t('myPosition.positionAcquired', { accuracy: Math.round(acc) }));
          setPoorAccuracy(false);
        } else if (acc <= ACCURACY_MODERATE) {
          setStatusMsg(t('myPosition.moderateAccuracy', { accuracy: Math.round(acc) }));
          setPoorAccuracy(false);
        } else if (acc <= ACCURACY_POOR) {
          setStatusMsg(t('myPosition.poorAccuracy', { accuracy: Math.round(acc) }));
          setPoorAccuracy(true);
        } else {
          setStatusMsg(t('myPosition.veryPoorAccuracy', { accuracy: Math.round(acc) }));
          setPoorAccuracy(true);
        }
        if (destination.lat != null && destination.lng != null && speed != null && speed > 0) {
          if (shouldRecalcRoute(latitude, longitude)) recalcRoute(latitude, longitude);
        }
      },
      (err) => {
        if (highAccuracy && !triedLowAccuracy && (err.code === 2 || err.code === 3)) {
          triedLowAccuracy = true;
          setStatusMsg(t('myPosition.gpsLowAccuracy'));
          tryWatch(false);
          return;
        }
        setStartingTracking(false);
        const errMap: Record<number, string> = { 1: t('myPosition.gpsPermissionDenied'), 2: t('myPosition.gpsUnavailable'), 3: t('myPosition.gpsTimeout') };
        const msg = errMap[err.code] || t('myPosition.gpsError', { error: err.message });
        setStatusMsg(msg);
        setTracking(false);
      },
      { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 30000 : 60000, timeout: highAccuracy ? 15000 : 30000 },
    );
    };

    tryWatch(true);
    intervalRef.current = setInterval(sendPosition, INTERVAL_DEFAULT);
    startRoutingRecalc();
    drainIntervalRef.current = setInterval(() => { drainQueue(); }, DRAIN_INTERVAL_MS);
  };

  const stopTracking = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    if (drainIntervalRef.current !== null) clearInterval(drainIntervalRef.current);
    watchRef.current = null; intervalRef.current = null; drainIntervalRef.current = null;
    lastMovingRef.current = Date.now();
    intervalDurationRef.current = INTERVAL_DEFAULT;
    setTracking(false); setQueueCount(0); setPoorAccuracy(false);
    setStartingTracking(false);
    setStatusMsg(t('myPosition.sharingStopped'));
    stopRoutingRecalc();
    setNavigationMode(false);
    setRoutingPolyline([]); setRoutingSteps([]);
    setRoutingETA(null); setRoutingDistance(0); setRoutingDuration(0);
    setRouteAlternatives(null);
  };

  useEffect(() => {
    const socket = getSocket();
    socket.on('connect', drainQueue);
    const onOnline = () => { drainQueue(); };
    window.addEventListener('online', onOnline);
    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      if (drainIntervalRef.current !== null) clearInterval(drainIntervalRef.current);
      socket.off('connect', drainQueue);
      window.removeEventListener('online', onOnline);
      stopRoutingRecalc();
    };
  }, [drainQueue, stopRoutingRecalc]);

  const hasDestination = destination.lat !== null && destination.lng !== null;
  const canStartNavigation = tracking && hasDestination && routingPolyline.length > 1 && !navigationMode;
  const navPosition = position ? { lat: position.lat, lng: position.lng, heading: position.heading, speed: position.speed } : null;

  return (
    <div className={navigationMode ? styles.pageNav : styles.page}>
      {!navigationMode && <h1 className={styles.title}>{t('myPosition.title')}</h1>}

      {!driver && (
        <div className={styles.noDriver}>
          {t('myPosition.noDriverProfile')}
        </div>
      )}

      {driver && (
        <div className={navigationMode ? styles.contentNav : styles.content}>
          {driver.vehicle && !navigationMode && (
            <div className={styles.card}>
              <span className={styles.vehicleInfo}>
                🚛 {driver.vehicle.brand} {driver.vehicle.model} — {driver.vehicle.licensePlate}
              </span>
            </div>
          )}

          {!navigationMode && (
            <>
              <div className={styles.card}>
                <label className={styles.label}>
                  📍 {t('myPosition.destination') || 'Destination'}
                </label>
                <LocationSearchInput
                  placeholder={t('myPosition.searchPlaceholder')}
                  value={destination}
                  onChange={(v) => {
                    setDestination(v);
                    setRouteAlternatives(null);
                    if (!v.lat || !v.lng) {
                      setRoutingPolyline([]); setRoutingSteps([]);
                      setRoutingETA(null); setRoutingDistance(0); setRoutingDuration(0);
                    }
                  }}
                  distanceFrom={position ? { lat: position.lat, lng: position.lng } : undefined}
                />

                {destinationHistory.length > 0 && (
                  <div className={styles.historySection}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHistory(!showHistory)}
                      style={{ padding: 0, color: 'var(--color-teal, #3FA796)' }}
                    >
                      🕐 {t(showHistory ? 'myPosition.historyToggleHide' : 'myPosition.historyToggleShow', { count: destinationHistory.length })}
                    </Button>
                    {showHistory && (
                      <div className={styles.historyList}>
                        {destinationHistory.map((h, i) => (
                          <Button
                            key={i}
                            variant="secondary"
                            size="sm"
                            fullWidth
                            onClick={() => {
                              setDestination({ lat: h.lat, lng: h.lng, label: h.label });
                              setShowHistory(false);
                              setRouteAlternatives(null);
                            }}
                            style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '8px 12px' }}
                          >
                            <span className={styles.historyLabel}>📍 {h.label}</span>
                            <span className={styles.historyDate}>
                              {formatDate(new Date(h.lastUsed))}
                            </span>
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {destination.label && destination.lat && destination.lng && position && (
                  <div className={styles.crowDistance}>
                    {t('myPosition.distanceAsCrowFlies', { label: destination.label, distance: haversineKm(position.lat, position.lng, destination.lat, destination.lng).toFixed(1) })}
                  </div>
                )}
              </div>

              <div className={styles.card}>
                <div className={styles.deliverySelectRow}>
                  <label className={styles.label}>{t('myPosition.deliveryToTrack')} :</label>
                  <select
                    value={selectedDelivery}
                    onChange={(e) => setSelectedDelivery(e.target.value)}
                    disabled={tracking}
                    className={styles.deliverySelect}
                  >
                    <option value="">{t('myPosition.selectDefault')}</option>
                    {deliveries.filter((d) => d.status === 'assigned' || d.status === 'in_progress').map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.status === 'in_progress' ? t('myDeliveries.status.in_progress') : t('myDeliveries.status.assigned')})
                      </option>
                    ))}
                  </select>
                </div>
                {deliveries.filter((d) => d.status === 'assigned' || d.status === 'in_progress').length === 0 && !tracking && (
                  <div className={styles.noDeliveries}>
                    {t('myPosition.noDeliveriesAvailable')}
                  </div>
                )}
              </div>

              {hasDestination && routingETA && (
                <div className={`${styles.card} ${styles.routeCard}`}>
                  <div className={styles.routeAccent} />
                  <div className={styles.routeContent}>
                    <div className={styles.routeTitle}>
                      {t('myPosition.routeCalculated')}
                    </div>
                    <div className={styles.routeStats}>
                      <div>
                        <div className={styles.routeStatLabel}>{t('myPosition.routeTime')}</div>
                        <div className={styles.routeStatValuePrimary}>
                          🕐 {routingETA}
                        </div>
                      </div>
                      <div>
                        <div className={styles.routeStatLabel}>{t('myPosition.routeDistance')}</div>
                        <div className={styles.routeStatValueSecondary}>
                          🛣️ {formatDistance(routingDistance)}
                        </div>
                      </div>
                      <div>
                        <div className={styles.routeStatLabel}>{t('myPosition.routeAverage')}</div>
                        <div className={styles.routeStatValueSecondary}>
                          ⚡ {routingDuration > 0 ? `${(routingDistance / routingDuration * 3.6).toFixed(0)} km/h` : '—'}
                        </div>
                      </div>
                    </div>

                    {routeAlternatives && routeAlternatives.length > 0 && (
                      <div className={styles.routeAlternatives}>
                        <div className={styles.routeAlternativesTitle}>
                          {t('myPosition.routeAlternatives')}
                        </div>
                        {routeAlternatives.map((alt, i) => (
                          <Button
                            key={i}
                            variant="secondary"
                            size="sm"
                            fullWidth
                            onClick={() => selectRoute(i + 1, alt)}
                            style={{ textAlign: 'left', justifyContent: 'flex-start', padding: '10px 12px', marginBottom: 4 }}
                          >
                            <div className={styles.altBtnTitle}>
                              {t('myPosition.routeOption', { number: i + 2 })}
                            </div>
                            <div className={styles.altBtnDetails}>
                              <span>🛣️ {formatDistance(alt.distance)}</span>
                              <span>🕐 {formatDuration(alt.duration)}</span>
                              {alt.duration < routingDuration && (
                                <span className={styles.altFaster}>{t('myPosition.routeFaster')}</span>
                              )}
                            </div>
                          </Button>
                        ))}
                      </div>
                    )}

                    {routingLoading && (
                      <div className={styles.routeCalcLoading}>
                        {t('myPosition.routeCalcLoading')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className={styles.card}>
                <div
                  className={styles.statusMsg}
                  style={{
                    color: statusMsg.includes('Arrivé') ? 'var(--color-teal, #3FA796)' : 'var(--color-text-secondary, #9BA6B9)',
                    fontWeight: statusMsg.includes('Arrivé') ? 600 : 400,
                  }}
                >
                  {statusMsg || (tracking ? t('myPosition.awaitingData') : t('myPosition.sharingDisabled'))}
                </div>
                {position && (
                  <div className={styles.coords}>
                    Lat: {position.lat.toFixed(6)}, Lng: {position.lng.toFixed(6)}
                    {position.accuracy !== undefined && ` ±${Math.round(position.accuracy)}m`}
                    {position.speed !== undefined && ` | ${(position.speed * 3.6).toFixed(1)} km/h`}
                    {position.heading !== undefined && ` | ${position.heading.toFixed(0)}°`}
                    {' | conf: '}{(confidenceLevel * 100).toFixed(0)}%
                    {sensorAvailable && (isStationary ? ' 🧘' : ' 🚶')}
                  </div>
                )}
                {poorAccuracy && tracking && (
                  <div className={styles.poorAccuracy}>
                    {t('myPosition.poorAccuracyWarning')}
                  </div>
                )}
                {queueCount > 0 && (
                  <div className={styles.offlineQueue}>
                    {t('myPosition.offlineQueue', { count: queueCount })}
                  </div>
                )}
                <div className={styles.actions}>
                  {!tracking ? (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={startingTracking}
                      onClick={startTracking}
                    >
                      {startingTracking ? t('myPosition.startingSharing') : t('myPosition.startSharing')}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={stopTracking}
                      >
                        {t('myPosition.stopSharing')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDataSaver(!dataSaver)}
                        title={t('myPosition.dataSaverTooltip')}
                      >
                        {dataSaver ? t('myPosition.dataSaverActive') : t('myPosition.dataSaverInactive')}
                      </Button>
                      {canStartNavigation && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            if (position && hasDestination) {
                              addDestinationHistory({
                                lat: destination.lat!,
                                lng: destination.lng!,
                                label: destination.label,
                              });
                              recalcRoute(position.lat, position.lng, true);
                              setNavigationMode(true);
                            }
                          }}
                        >
                          {t('myPosition.startNavigation')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          <div
            className={styles.mapWrap}
            style={{
              height: navigationMode ? '100dvh' : 400,
              borderRadius: navigationMode ? 0 : 'var(--radius-lg, 8px)',
            }}
          >
            <MapContainer
              center={position ? [position.lat, position.lng] : [-18.8792, 47.5079]}
              zoom={navigationMode ? 16 : (position ? 15 : 13)}
              style={{ height: '100%', width: '100%' }}
              key={navigationMode ? 'nav-map' : 'normal-map'}
              zoomControl={!navigationMode}
              attributionControl={!navigationMode}
            >
              {navigationMode && position && (
                <MapFollowPosition lat={position.lat} lng={position.lng} enabled={navigationMode} />
              )}

              <MapLayerSwitcher />
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              {position && !navigationMode && (
                <Marker position={[position.lat, position.lng]}>
                  <Popup>
                    {driverName}<br />
                    {t('myPosition.accuracy')}: {position.accuracy ? `${Math.round(position.accuracy)}m` : t('myPosition.accuracyNA')}<br />
                    {position.speed !== undefined && `${(position.speed * 3.6).toFixed(1)} km/h`}
                    {position.heading !== undefined && ` | ${position.heading.toFixed(0)}°`}
                    {routingETA && <> | ETA: {routingETA}</>}
                  </Popup>
                </Marker>
              )}

              {hasDestination && (
                <Marker position={[destination.lat!, destination.lng!]}>
                  <Popup>
                    📍 {destination.label || t('myPosition.destination')}
                  </Popup>
                </Marker>
              )}

              {activeDelivery?.pickupLat && activeDelivery?.pickupLng && (
                <Marker position={[activeDelivery.pickupLat, activeDelivery.pickupLng]}>
                  <Popup>{t('myPosition.pickupPopup', { address: activeDelivery.pickupAddress })}</Popup>
                </Marker>
              )}

              {plannedRoute.length > 1 && (
                <Polyline
                  positions={plannedRoute}
                  color="#3B82F6"
                  weight={5}
                  opacity={0.55}
                  dashArray="14 10"
                />
              )}

              {routingPolyline.length > 1 && (
                <Polyline
                  positions={routingPolyline}
                  color="#3FA796"
                  weight={6}
                  opacity={0.9}
                />
              )}
            </MapContainer>

            {navigationMode && navPosition && (
              <NavigationOverlay
                position={navPosition}
                destination={{ lat: destination.lat!, lng: destination.lng!, label: destination.label }}
                routePolyline={routingPolyline}
                routeSteps={routingSteps}
                routingDistance={routingDistance}
                routingDuration={routingDuration}
                onRecalcRoute={onRecalcRouteFromNav}
                onExitNavigation={() => setNavigationMode(false)}
                onArrival={() => { setStatusMsg(t('myPosition.arrivedAtDestination')); }}
                isRecalculating={routingLoading}
                dataSaver={dataSaver}
                onToggleDataSaver={() => setDataSaver(!dataSaver)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
