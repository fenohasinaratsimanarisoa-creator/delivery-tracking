import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api/client';
import { getSocket } from '../services/socket/socket';
import { enqueuePosition, queueSize, flushQueue } from '../services/offlineQueue';
import { KalmanFilter } from '../services/tracking/KalmanFilter';
import { sensorFusion, simulateStationaryFromSpeed } from '../services/tracking/sensorFusion';
import type { Delivery } from '../types';

let wakeLockRef: WakeLockSentinel | null = null;
async function acquireWakeLock() {
  if (!navigator.wakeLock) return false;
  try {
    wakeLockRef = await navigator.wakeLock.request('screen');
    wakeLockRef!.addEventListener('release', () => { wakeLockRef = null; });
    return true;
  } catch { return false; }
}
function releaseWakeLock() {
  if (wakeLockRef) { wakeLockRef.release?.(); wakeLockRef = null; }
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
const DRAIN_INTERVAL_MS = 10000;
const PROXIMITY_THRESHOLD_M = 300;
const PROXIMITY_REMINDER_MS = 5 * 60 * 1000;
const SNOOZE_MS = 5 * 60 * 1000;
const ESCALATION_AFTER_MS = 15 * 60 * 1000;
const ESCALATION_SNOOZE_MS = 2 * 60 * 1000;
const QUEUE_WARN_THRESHOLD = 50;

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

export interface DriverAlert {
  type: 'proximity' | 'cascade' | 'geofence' | 'poor_accuracy' | 'queue_full' | 'geo_denied' | 'background_stop';
  title: string;
  message: string;
  deliveryId?: string;
  urgency?: 'normal' | 'high' | 'critical';
  snoozedUntil?: number;
}

export interface TrackingStatus {
  active: boolean;
  position: DriverPosition | null;
  positionSource: string;
  confidence: number;
  poorAccuracy: boolean;
  isStationary: boolean;
  queueCount: number;
  statusMsg: string;
  geolocationDenied: boolean;
  activeDeliveryId: string;
  alerts: DriverAlert[];
  dismissAlert: (type: string, deliveryId?: string) => void;
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
  const [alerts, setAlerts] = useState<DriverAlert[]>([]);
  const lastProximityAlertRef = useRef(0);
  const soundEnabledRef = useRef(true);
  const inProgressDeliveryRef = useRef<Delivery | null>(null);
  const allDeliveriesRef = useRef<Delivery[]>([]);
  const proximitySnoozedUntilRef = useRef(0);
  const escalationLevelRef = useRef(0);
  const enterProximityTimeRef = useRef(0);
  const cascadeSnoozedRef = useRef<Record<string, number>>({});

  const kalmanRef = useRef<KalmanFilter | null>(null);
  const filteredPosRef = useRef<{ lat: number; lng: number; confidence: number } | null>(null);
  const rawPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const watchRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenSinceRef = useRef<number>(0);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
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
    queryFn: () => api.get('/drivers/profile').then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: deliveriesData } = useQuery({
    queryKey: ['my-deliveries'],
    queryFn: () => api.get('/deliveries/my-deliveries').then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const driver = profile as { id: string; firstName: string; lastName: string; vehicle?: { id: string; brand: string; model: string; licensePlate: string; positionSource?: string } } | undefined;
  const deliveries: Delivery[] = deliveriesData?.data ?? [];
  const vehicleId = driver?.vehicle?.id || '';
  const positionSource = driver?.vehicle?.positionSource || 'phone';
  const usesPhysicalTracker = positionSource === 'physical_tracker';
  const usesPhysicalTrackerRef = useRef(usesPhysicalTracker);
  usesPhysicalTrackerRef.current = usesPhysicalTracker;

  const inProgressDelivery = deliveries.find((d) => d.status === 'in_progress');
  const autoDeliveryId = inProgressDelivery?.id || '';

  deliveryIdRef.current = autoDeliveryId;
  inProgressDeliveryRef.current = inProgressDelivery ?? null;
  allDeliveriesRef.current = deliveries;
  if (autoDeliveryId !== activeDeliveryId) {
    setActiveDeliveryId(autoDeliveryId);
    setAlerts([]);
    lastProximityAlertRef.current = 0;
    proximitySnoozedUntilRef.current = 0;
    escalationLevelRef.current = 0;
    enterProximityTimeRef.current = 0;
    cascadeSnoozedRef.current = {};
  }

  const addAlert = useCallback((alert: DriverAlert) => {
    setAlerts((prev) => {
      const existing = prev.find((a) => a.type === alert.type && a.deliveryId === alert.deliveryId);
      if (existing && existing.snoozedUntil && Date.now() < existing.snoozedUntil) return prev;
      if (existing && existing.urgency === alert.urgency && existing.title === alert.title) return prev;
      return [...prev.filter((a) => !(a.type === alert.type && a.deliveryId === alert.deliveryId)), alert];
    });
    // Native notification if permission granted and alert is urgent
    if ((alert.urgency === 'high' || alert.urgency === 'critical') && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(alert.title, { body: alert.message, icon: '/favicon.ico', tag: `${alert.type}:${alert.deliveryId || ''}` });
      } catch {}
    }
  }, []);

  const removeAlert = useCallback((type: string, deliveryId?: string) => {
    setAlerts((prev) => prev.filter((a) => !(a.type === type && a.deliveryId === deliveryId)));
  }, []);

  const checkProximity = useCallback((lat: number, lng: number) => {
    const now = Date.now();
    const deliveries = allDeliveriesRef.current;
    const inProgress = deliveries.filter((d: Delivery) => d.status === 'in_progress');

    if (inProgress.length === 0) {
      removeAlert('proximity', '');
      removeAlert('cascade', '');
      return;
    }

    // Cascade check: if a previous delivery is still in_progress while we're near the current one
    for (let i = 1; i < inProgress.length; i++) {
      const prev = inProgress[i - 1];
      const curr = inProgress[i];
      if (prev.status === 'in_progress' && curr.deliveryLat && curr.deliveryLng) {
        const distToCurr = haversineDistanceM(lat, lng, curr.deliveryLat, curr.deliveryLng);
        if (distToCurr <= PROXIMITY_THRESHOLD_M) {
          const cascadeKey = `cascade:${prev.id}`;
          if (!cascadeSnoozedRef.current[cascadeKey] || now - cascadeSnoozedRef.current[cascadeKey] > PROXIMITY_REMINDER_MS) {
            addAlert({
              type: 'cascade',
              title: 'Livraison précédente non validée',
              message: `"${prev.title || 'Livraison ' + prev.id.slice(0, 8)}" n'a pas encore été marquée comme livrée. Validez-la d'abord.`,
              deliveryId: prev.id,
              urgency: 'high',
            });
          }
        }
      }
    }

    // Proximity check on the first active delivery
    const delivery = inProgress[0];
    if (!delivery || !delivery.deliveryLat || !delivery.deliveryLng) {
      removeAlert('proximity', delivery?.id);
      return;
    }

    const dist = haversineDistanceM(lat, lng, delivery.deliveryLat, delivery.deliveryLng);

    if (dist <= PROXIMITY_THRESHOLD_M) {
      if (enterProximityTimeRef.current === 0) {
        enterProximityTimeRef.current = now;
      }
      const timeInZone = now - enterProximityTimeRef.current;
      const escalationLevel = timeInZone > ESCALATION_AFTER_MS ? 2 : timeInZone > ESCALATION_AFTER_MS / 2 ? 1 : 0;
      escalationLevelRef.current = escalationLevel;

      if (now < proximitySnoozedUntilRef.current) return;

      if (now - lastProximityAlertRef.current > PROXIMITY_REMINDER_MS) {
        lastProximityAlertRef.current = now;
        addAlert({
          type: 'proximity',
          title: delivery.title || 'Livraison',
          message: escalationLevel >= 2
            ? `⚠️ Vous êtes sur place depuis plus de ${Math.round(timeInZone / 60000)} min. Veuillez valider la livraison.`
            : 'Vous êtes à proximité du point de livraison. N\'oubliez pas de valider.',
          deliveryId: delivery.id,
          urgency: escalationLevel >= 2 ? 'critical' : escalationLevel >= 1 ? 'high' : 'normal',
        });
      }
    } else {
      enterProximityTimeRef.current = 0;
      escalationLevelRef.current = 0;
      removeAlert('proximity', delivery?.id);
    }
  }, [addAlert, removeAlert]);

  const dismissAlert = useCallback((type: string, deliveryId?: string) => {
    if (type === 'proximity') {
      setAlerts((prev) => prev.filter((a) => !(a.type === 'proximity' && a.deliveryId === deliveryId)));
      const escalation = escalationLevelRef.current;
      const snoozeTime = escalation >= 2 ? ESCALATION_SNOOZE_MS : SNOOZE_MS;
      proximitySnoozedUntilRef.current = Date.now() + snoozeTime;
      soundEnabledRef.current = true;
      if (escalation >= 1 && navigator.vibrate) navigator.vibrate(200);

      // Informe le serveur du snooze (throttling réel côté serveur) : il ne
      // réémettra plus proximityAlert pour cette livraison tant que la fenêtre de
      // snooze n'est pas écoulée. L'état local reste conservé comme protection
      // immédiate (latence réseau avant confirmation serveur) — défense en
      // profondeur. Les versions qui n'écoutent pas ce message restent
      // fonctionnelles (alertes réémises, juste moins optimisées).
      if (deliveryId) {
        const socket = getSocket();
        if (socket.connected) {
          socket.emit('snoozeProximityAlert', { deliveryId, escalationLevel: escalation });
        }
      }
    } else if (type === 'cascade' && deliveryId) {
      cascadeSnoozedRef.current[`cascade:${deliveryId}`] = Date.now();
      setAlerts((prev) => prev.filter((a) => !(a.type === 'cascade' && a.deliveryId === deliveryId)));
    } else {
      setAlerts((prev) => prev.filter((a) => !(a.type === type && a.deliveryId === deliveryId)));
    }
  }, []);

  const refreshQueueCount = useCallback(async () => {
    const count = await queueSize();
    setQueueCount(count);
  }, []);

  const drainQueue = useCallback(async () => {
    const socket = getSocket();
    if (!socket.connected) return;
    try {
      await flushQueue(async (positions) => {
        return new Promise<void>((resolve, reject) => {
          socket.emit('batchPosition', { positions });
          socket.once('positionsSaved', () => resolve());
          const timeout = setTimeout(() => reject(new Error('flush timeout')), 15000);
          socket.once('positionsSaved', () => { clearTimeout(timeout); resolve(); });
        });
      });
    } catch (err) {
      console.warn('[drainQueue] flush failed:', err);
    }
    refreshQueueCount();
  }, [refreshQueueCount]);

  useEffect(() => {
    if (queueCount >= QUEUE_WARN_THRESHOLD) {
      addAlert({ type: 'queue_full', title: 'Connexion instable', message: `${queueCount} positions en attente. Les données GPS peuvent ne pas être transmises en temps réel au dispatcher.`, urgency: 'high' });
    } else {
      removeAlert('queue_full', '');
    }
  }, [queueCount, addAlert, removeAlert]);

  const sendPosition = useCallback(() => {
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    const p = posRef.current;
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

    const raw = rawPosRef.current;
    const sendLat = raw ? raw.lat : p.lat;
    const sendLng = raw ? raw.lng : p.lng;

    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      event: 'updatePosition',
      latitude: sendLat, longitude: sendLng,
      speed: p.speed ?? undefined, heading: p.heading,
      altitude: p.altitude, accuracy: acc,
      timestamp: now,
    };
    if (vId) payload.vehicleId = vId;
    if (dId) payload.deliveryId = dId;
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('updatePosition', payload);
      const posTimeout = setTimeout(() => { isSendingRef.current = false; }, 3000);
      socket.once('positionSaved', () => {
        clearTimeout(posTimeout);
        isSendingRef.current = false;
      });
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
        rawPosRef.current = { lat: latitude, lng: longitude };

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
          removeAlert('poor_accuracy', '');
        } else if (acc <= ACCURACY_MODERATE) {
          setStatusMsg('');
          setPoorAccuracy(false);
          removeAlert('poor_accuracy', '');
        } else if (acc <= ACCURACY_POOR) {
          setPoorAccuracy(true);
          addAlert({ type: 'poor_accuracy', title: 'GPS faible', message: `La précision GPS est faible (±${Math.round(acc)}m). Déplacez-vous dans une zone dégagée.`, urgency: 'normal' });
        } else {
          setPoorAccuracy(true);
          addAlert({ type: 'poor_accuracy', title: 'GPS très faible', message: `La précision GPS est très faible (±${Math.round(acc)}m). Les positions envoyées peuvent être imprécises.`, urgency: 'high' });
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
          addAlert({ type: 'geo_denied', title: 'Géolocalisation refusée', message: 'Activez la géolocalisation dans les paramètres du navigateur pour envoyer votre position au dispatcher.', urgency: 'critical' });
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

    acquireWakeLock();

    // Request notification permission when driver starts tracking (non-intrusive)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const triedLowAccuracyRef = { current: false };
    tryWatch(true, triedLowAccuracyRef);
    intervalRef.current = setInterval(sendPosition, INTERVAL_DEFAULT);
    drainIntervalRef.current = setInterval(() => { drainQueue(); }, DRAIN_INTERVAL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenSinceRef.current > 0) {
        const gapSec = Math.round((Date.now() - hiddenSinceRef.current) / 1000);
        if (gapSec > 15) {
          addAlert({
            type: 'background_stop',
            title: 'Tracking interrompu',
            message: `L\'application était en arrière-plan pendant ${gapSec}s. Les positions GPS n\'ont pas été envoyées durant cette période. Gardez l\'app ouverte pour un tracking continu.`,
            urgency: 'high',
          });
        }
        acquireWakeLock();
        hiddenSinceRef.current = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    visibilityHandlerRef.current = () => document.removeEventListener('visibilitychange', onVisibility);
  }, [vehicleId, tryWatch, sendPosition, drainQueue, addAlert]);

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
    if (visibilityHandlerRef.current) {
      visibilityHandlerRef.current();
      visibilityHandlerRef.current = null;
    }
    releaseWakeLock();
    hiddenSinceRef.current = 0;
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
    socket.on('dataUpdate', (event: { entity: string; action: string; geofenceName: string; deliveryId?: string }) => {
      if (event.entity === 'geofence_event') {
        addAlert({
          type: 'geofence',
          title: `Zone ${event.action === 'entry' ? 'entrée' : 'sortie'}`,
          message: `Vous avez ${event.action === 'entry' ? 'atteint' : 'quitté'} la zone "${event.geofenceName}"`,
          deliveryId: event.deliveryId,
          urgency: 'high',
        });
      }
    });
    socket.on('proximityAlert', (alert: { type: string; urgency?: 'normal' | 'high' | 'critical'; title?: string; message: string; deliveryId?: string }) => {
      if (alert.type === 'proximity' && usesPhysicalTrackerRef.current) {
        const urgency = alert.urgency || 'normal';
        addAlert({
          type: 'proximity',
          title: alert.title || 'Livraison',
          message: alert.message,
          deliveryId: alert.deliveryId,
          urgency,
        });
      }
    });
    const onOnline = () => { drainQueue(); };
    window.addEventListener('online', onOnline);

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      if (drainIntervalRef.current !== null) clearInterval(drainIntervalRef.current);
      socket.off('connect', drainQueue);
      socket.off('dataUpdate');
      socket.off('proximityAlert');
      window.removeEventListener('online', onOnline);
    };
  }, [drainQueue, addAlert]);

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
    active: startedRef.current || usesPhysicalTracker,
    position,
    positionSource,
    confidence: confidenceLevel,
    poorAccuracy,
    isStationary,
    queueCount,
    statusMsg,
    geolocationDenied,
    activeDeliveryId,
    alerts,
    dismissAlert,
  };

  return trackingStatus;
}
