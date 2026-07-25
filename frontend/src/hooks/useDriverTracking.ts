import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api/client';
import { getSocket } from '../services/socket/socket';
import { enqueuePosition, dequeueAllPositions, clearQueue, queueSize } from '../services/offlineQueue';
import { KalmanFilter } from '../services/tracking/KalmanFilter';
import { sensorFusion, simulateStationaryFromSpeed } from '../services/tracking/sensorFusion';
import type { Delivery } from '../types';

const ACCURACY_GOOD = 10;
const ACCURACY_MODERATE = 30;
const ACCURACY_POOR = 50;
const ACCURACY_REJECT = 80;
const SPEED_MOVING_THRESHOLD_MS = 1.39;
const STOPPED_DURATION_MS = 30_000;
const INTERVAL_FAST = 3000;
const INTERVAL_SLOW = 20000;
const INTERVAL_DEFAULT = 5000;
const DRAIN_INTERVAL_MS = 10000;
const PROXIMITY_THRESHOLD_M = 300;
const PROXIMITY_REMINDER_MS = 5 * 60 * 1000;

function haversineDistanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface DriverPosition {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  altitude?: number;
  accuracy?: number;
}

export interface TrackingStatus {
  active: boolean;
  position: DriverPosition | null;
  confidence: number;
  poorAccuracy: boolean;
  isStationary: boolean;
  queueCount: number;
  statusMsg: string;
  geolocationDenied: boolean;
  activeDeliveryId: string;
  proximityAlert: boolean;
  proximityDeliveryTitle: string;
  dismissProximityAlert: () => void;
}

export function useDriverTracking() {
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState(1);
  const [poorAccuracy, setPoorAccuracy] = useState(false);
  const [isStationary, setIsStationary] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [geolocationDenied, setGeolocationDenied] = useState(false);
  const [activeDeliveryId, setActiveDeliveryId] = useState('');
  const [proximityAlert, setProximityAlert] = useState(false);
  const [proximityDeliveryTitle, setProximityDeliveryTitle] = useState('');
  const proximityDismissedRef = useRef(false);
  const lastProximityAlertRef = useRef(0);
  const soundEnabledRef = useRef(true);
  const inProgressDeliveryRef = useRef<any>(null);

  const kalmanRef = useRef<KalmanFilter | null>(null);
  const filteredPosRef = useRef<{ lat: number; lng: number; confidence: number } | null>(null);
  const watchRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMovingRef = useRef<number>(Date.now());
  const intervalDurationRef = useRef<number>(INTERVAL_DEFAULT);
  const posRef = useRef(position);
  const isSendingRef = useRef(false);
  const startedRef = useRef(false);
  const deliveryIdRef = useRef('');
  posRef.current = position;

  const { data: profile } = useQuery({
    queryKey: ['driver-profile'],
    queryFn: () => api.get('/drivers/profile').then((r: any) => r.data),
    staleTime: 60_000,
  });

  const { data: deliveriesData } = useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => api.get('/deliveries/my-deliveries').then((r: any) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const driver = profile as { id: string; firstName: string; lastName: string; vehicle?: { id: string; brand: string; model: string; licensePlate: string; positionSource?: string } } | undefined;
  const deliveries: Delivery[] = deliveriesData?.data ?? [];
  const vehicleId = driver?.vehicle?.id || '';
  const positionSource = driver?.vehicle?.positionSource || 'phone';
  const usesPhysicalTracker = positionSource === 'physical_tracker';

  const inProgressDelivery = deliveries.find((d) => d.status === 'in_progress');
  const autoDeliveryId = inProgressDelivery?.id || '';

  deliveryIdRef.current = autoDeliveryId;
  inProgressDeliveryRef.current = inProgressDelivery;
  if (autoDeliveryId !== activeDeliveryId) {
    setActiveDeliveryId(autoDeliveryId);
    setProximityAlert(false);
    proximityDismissedRef.current = false;
    lastProximityAlertRef.current = 0;
  }

  const checkProximity = useCallback((lat: number, lng: number) => {
    const delivery = inProgressDeliveryRef.current;
    if (!delivery || !delivery.deliveryLat || !delivery.deliveryLng) {
      setProximityAlert(false);
      return;
    }
    if (delivery.status !== 'in_progress') {
      setProximityAlert(false);
      return;
    }
    if (proximityDismissedRef.current) return;

    const dist = haversineDistanceM(lat, lng, delivery.deliveryLat, delivery.deliveryLng);
    const now = Date.now();

    if (dist <= PROXIMITY_THRESHOLD_M) {
      if (now - lastProximityAlertRef.current > PROXIMITY_REMINDER_MS) {
        lastProximityAlertRef.current = now;
        setProximityAlert(true);
        setProximityDeliveryTitle(delivery.title || '');
      }
    } else {
      setProximityAlert(false);
    }
  }, []);

  const dismissProximityAlert = useCallback(() => {
    setProximityAlert(false);
    proximityDismissedRef.current = true;
    soundEnabledRef.current = true;
  }, []);

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
      socket.emit('batchPosition', { positions }, (ack: any) => {
        if (ack?.event === 'positionsSaved') {
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
    const dId = deliveryIdRef.current;
    const vId = vehicleId;
    if (!p) { isSendingRef.current = false; return; }

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
    const payload: Record<string, unknown> = {
      event: 'updatePosition',
      latitude: sendLat, longitude: sendLng,
      speed: p.speed ?? undefined, heading: p.heading,
      altitude: p.altitude, accuracy: acc,
      confidence,
      timestamp: now,
    };
    if (vId) payload.vehicleId = vId;
    if (dId) payload.deliveryId = dId;
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('updatePosition', payload, () => { isSendingRef.current = false; });
      setTimeout(() => { isSendingRef.current = false; }, 2000);
    } else {
      enqueuePosition(payload).then(() => { refreshQueueCount(); isSendingRef.current = false; });
    }
  }, [vehicleId, refreshQueueCount]);

  const recalcInterval = useCallback((speed: number | undefined, accuracy?: number, stationary?: boolean) => {
    const now = Date.now();
    if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) lastMovingRef.current = now;
    let ni: number;
    const isStationaryNow = stationary === true || (speed !== undefined && speed < 0.1);
    if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) {
      ni = accuracy !== undefined && accuracy > ACCURACY_MODERATE && accuracy < ACCURACY_REJECT
        ? INTERVAL_FAST : INTERVAL_FAST;
    } else if (isStationaryNow && (now - lastMovingRef.current > STOPPED_DURATION_MS)) {
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

  const tryWatch = useCallback((highAccuracy: boolean, triedLowAccuracyRef: { current: boolean }) => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
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
        const isActuallyStationary = stationaryFromSensor === null ? stationaryFromSpeed : stationaryFromSensor;

        filteredPosRef.current = { lat: filtered.lat, lng: filtered.lng, confidence: conf };

        const p: DriverPosition = {
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
        checkProximity(filtered.lat, filtered.lng);

        if (acc <= ACCURACY_GOOD) {
          setStatusMsg('');
          setPoorAccuracy(false);
        } else if (acc <= ACCURACY_MODERATE) {
          setStatusMsg('');
          setPoorAccuracy(false);
        } else if (acc <= ACCURACY_POOR) {
          setPoorAccuracy(true);
        } else {
          setPoorAccuracy(true);
        }
      },
      (err) => {
        if (highAccuracy && !triedLowAccuracyRef.current && (err.code === 2 || err.code === 3)) {
          triedLowAccuracyRef.current = true;
          tryWatch(false, triedLowAccuracyRef);
          return;
        }
        if (err.code === 1) {
          setGeolocationDenied(true);
          setStatusMsg('geolocation_denied');
        } else {
          setStatusMsg('gps_error');
        }
      },
      { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 30000 : 60000, timeout: highAccuracy ? 15000 : 30000 },
    );
  }, [recalcInterval]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocationDenied(false);
    setPoorAccuracy(false);
    setConfidenceLevel(1);
    kalmanRef.current = null;
    filteredPosRef.current = null;

    sensorFusion.init().then(() => {}).catch(() => {});

    const triedLowAccuracyRef = { current: false };
    tryWatch(true, triedLowAccuracyRef);
    intervalRef.current = setInterval(sendPosition, INTERVAL_DEFAULT);
    drainIntervalRef.current = setInterval(() => { drainQueue(); }, DRAIN_INTERVAL_MS);
  }, [vehicleId, tryWatch, sendPosition, drainQueue]);

  const stopTracking = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (drainIntervalRef.current !== null) {
      clearInterval(drainIntervalRef.current);
      drainIntervalRef.current = null;
    }
    lastMovingRef.current = Date.now();
    intervalDurationRef.current = INTERVAL_DEFAULT;
    setPosition(null);
    setQueueCount(0);
    setPoorAccuracy(false);
    setStatusMsg('');
  }, []);

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
    };
  }, [drainQueue]);

  useEffect(() => {
    if (!driver || usesPhysicalTracker) {
      if (startedRef.current) {
        stopTracking();
        startedRef.current = false;
      }
      return;
    }

    if (!startedRef.current) {
      startedRef.current = true;
      const timeout = setTimeout(() => {
        startTracking();
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [driver, startTracking, stopTracking]);

  const trackingStatus: TrackingStatus = {
    active: startedRef.current && !usesPhysicalTracker,
    position,
    confidence: confidenceLevel,
    poorAccuracy,
    isStationary,
    queueCount,
    statusMsg,
    geolocationDenied,
    activeDeliveryId,
    proximityAlert,
    proximityDeliveryTitle,
    dismissProximityAlert,
  };

  return trackingStatus;
}
