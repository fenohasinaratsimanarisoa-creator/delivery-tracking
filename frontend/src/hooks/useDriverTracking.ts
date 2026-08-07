import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api/client';
import { getSocket } from '../services/socket/socket';
import { enqueuePosition, queueSize, flushQueue } from '../services/offlineQueue';
import { KalmanFilter } from '../services/tracking/KalmanFilter';
import { sensorFusion, simulateStationaryFromSpeed } from '../services/tracking/sensorFusion';
import {
  getBackgroundLocationStatus,
  requestBackgroundLocationPermissions,
  startBackgroundLocation,
  stopBackgroundLocation,
  subscribeToNativeLocations,
} from '../services/tracking/backgroundLocation';
import type { Delivery } from '../types';

// Wake lock 'screen' RETIRÉ : il n'empêche l'écran de s'éteindre que PENDANT que
// l'app est visible, et le navigateur le relâche automatiquement dès que
// document.visibilityState passe à 'hidden' — donc juste au moment où on en aurait
// besoin (écran verrouillé / app en arrière-plan). Il n'a donc AUCUN effet utile
// pour maintenir l'acquisition GPS en arrière-plan. La vraie continuité derrière
// l'écran verrouillé vient du foreground service natif LocationForegroundService
// (acquisition via FusedLocationProviderClient, indépendante de la WebView), pas
// d'un Wake Lock JS. releaseWakeLock() est conservé pour symétrie/robustesse
// (no-op tant que rien n'est acquis).
let wakeLockRef: WakeLockSentinel | null = null;
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
  type: 'proximity' | 'cascade' | 'geofence' | 'poor_accuracy' | 'queue_full' | 'geo_denied' | 'background_continued';
  title: string;
  message: string;
  deliveryId?: string;
  urgency?: 'normal' | 'high' | 'critical';
  escalationLevel?: number;
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
  const alertsRef = useRef<DriverAlert[]>([]);
  alertsRef.current = alerts;
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
  const nativeSubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
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
          escalationLevel,
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
      // L'escalade de l'alerte réellement affichée prime (elle provient du serveur
      // pour les véhicules physical_tracker) ; sinon repli sur la ref locale (app
      // téléphone). Permet au snooze serveur de recevoir le bon niveau d'escalade.
      const alertEscalation = alertsRef.current.find(
        (a) => a.type === 'proximity' && a.deliveryId === deliveryId,
      )?.escalationLevel;
      const escalation = alertEscalation ?? escalationLevelRef.current;
      const snoozeTime = escalation >= 2 ? ESCALATION_SNOOZE_MS : SNOOZE_MS;
      setAlerts((prev) => prev.filter((a) => !(a.type === 'proximity' && a.deliveryId === deliveryId)));
      proximitySnoozedUntilRef.current = Date.now() + snoozeTime;
      // Le rappel suivant doit survenir à l'EXPIRATION du snooze (2 min en escalade,
      // 5 min sinon), pas au rythme de rappel fixe de 5 min (PROXIMITY_REMINDER_MS) :
      // sinon, en escalade 2, on n'entendrait jamais de son à +2 min. On réinitialise
      // la référence du dernier rappel pour que la fenêtre de snooze serve de cadence.
      lastProximityAlertRef.current = 0;
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
          // Un seul listener nommé (les deux .once précédents étaient redondants :
          // le premier ne résolvait que la promesse sans clear le timeout, et restait
          // actif 15s ; s'il ne se déclenchait jamais, il aurait pu résoudre une
          // promesse déjà rejetée). Ce handler retire le timeout puis résout.
          const onPositionsSaved = () => { clearTimeout(timeout); resolve(); };
          const timeout = setTimeout(() => {
            // Retire le listener restant : un 'positionsSaved' tardif (ex. d'un flush
            // suivant) ne doit pas résoudre une promesse déjà rejetée, ni fuiter.
            socket.off('positionsSaved', onPositionsSaved);
            reject(new Error('flush timeout'));
          }, 15000);
          socket.once('positionsSaved', onPositionsSaved);
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
      // Position rejetée par le serveur (ex. véhicule désactivé/mal configuré) :
      // on la remet en file d'attente locale (même mécanisme que le cas socket
      // déconnecté) pour qu'elle soit retentée via drainQueue plutôt que perdue, et
      // on libère isSendingRef comme dans le cas de succès.
      socket.once('positionRejected', () => {
        clearTimeout(posTimeout);
        enqueuePosition(payload).then(() => { refreshQueueCount(); isSendingRef.current = false; });
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

  // Coords normalisés : servent aussi bien au callback watchPosition (JS) qu'aux
  // positions natives du plugin Android (acquisitions FusedLocationProviderClient
  // indépendantes de la WebView). Une seule et même logique de traitement
  // (Kalman, stationnarité, checkProximity, intervalle d'envoi, alertes précision)
  // alimente les deux sources, sans duplication.
  type GeoCoords = {
    latitude: number;
    longitude: number;
    speed?: number | null;
    heading?: number | null;
    altitude?: number | null;
    accuracy?: number | null;
  };

  const processCoords = useCallback((coords: GeoCoords) => {
    const { latitude, longitude, speed, heading, altitude } = coords;
    const acc = coords.accuracy ?? 50;

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
  }, [recalcInterval, checkProximity, addAlert, removeAlert]);

  const tryWatch = useCallback((highAccuracy: boolean, triedLowAccuracyRef: { current: boolean }) => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        processCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          altitude: pos.coords.altitude,
          accuracy: pos.coords.accuracy,
        });
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
  }, [processCoords]);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeolocationDenied(false);
    setPoorAccuracy(false);
    setConfidenceLevel(1);
    kalmanRef.current = null;
    filteredPosRef.current = null;

    sensorFusion.init().then(() => {}).catch(() => {});

    // (Wake lock 'screen' retiré : illusoire en arrière-plan — voir en-tête du
    // fichier. La continuité derrière l'écran verrouillé est assurée par le
    // foreground service natif LocationForegroundService, démarré ci-dessous.)

    // Demande la permission de notification native (Android 13+) + permission de
    // localisation "toujours" (flow Android 11+), puis démarre le foreground
    // service de type "location" : il maintient le process vivant pendant
    // l'écran verrouillé afin que watchPosition + setInterval continuent.
    getBackgroundLocationStatus()
      .then((status) => {
        if (!status.running) {
          return requestBackgroundLocationPermissions()
            .then(() => startBackgroundLocation())
            .catch((err) => {
              console.warn('[tracking] native background service start failed:', err);
            });
        }
        return undefined;
      })
      .catch((err) => {
        console.warn('[tracking] native background status check failed:', err);
      });

    // Request notification permission when driver starts tracking (non-intrusive)
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const triedLowAccuracyRef = { current: false };
    tryWatch(true, triedLowAccuracyRef);
    intervalRef.current = setInterval(sendPosition, INTERVAL_DEFAULT);
    drainIntervalRef.current = setInterval(() => { drainQueue(); }, DRAIN_INTERVAL_MS);

    // S'abonne aux positions acquises nativement par LocationForegroundService
    // (FusedLocationProviderClient) : en arrière-plan / écran verrouillé, quand
    // la WebView est suspendue et que watchPosition ne produit plus rien, ces
    // positions natives continuent d'alimenter processCoords → même pipeline
    // Kalman / checkProximity / sendPosition. Sur iOS/web le plugin est null et
    // subscribeToNativeLocations retourne null : watchPosition reste l'unique
    // source (repli conservé, aucune régression).
    subscribeToNativeLocations((nativePos) => {
      processCoords({
        latitude: nativePos.latitude,
        longitude: nativePos.longitude,
        speed: nativePos.speed,
        heading: nativePos.heading,
        altitude: nativePos.altitude,
        accuracy: nativePos.accuracy,
      });
    })
      .then((sub) => {
        nativeSubscriptionRef.current = sub;
      })
      .catch(() => {});


    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
      } else if (document.visibilityState === 'visible' && hiddenSinceRef.current > 0) {
        const gapSec = Math.round((Date.now() - hiddenSinceRef.current) / 1000);
        if (gapSec > 15) {
          // Depuis le passage en arrière-plan natif (foreground service location),
          // le tracking continue pendant l'écran verrouillé. Cette alerte ne signale
          // plus un tracking cassé : elle confirme que le suivi est resté actif.
          getBackgroundLocationStatus()
            .then((status) => {
              if (status.running) {
                const gapMin = Math.round(gapSec / 60);
                addAlert({
                  type: 'background_continued',
                  title: 'Tracking maintenu en arrière-plan',
                  message: `Le suivi est resté actif pendant ${gapMin} min derrière l'écran verrouillé. Les positions continuent d'être envoyées au dispatcher.`,
                  urgency: 'normal',
                });
              }
            })
            .catch(() => {});
        }
        // (Wake lock 'screen' retiré ici aussi : le navigateur le relâche dès que
        // la page passe en 'hidden', donc inutile au retour depuis l'écran
        // verrouillé. La continuité en arrière-plan est le rôle du foreground
        // service natif LocationForegroundService.)
        hiddenSinceRef.current = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    visibilityHandlerRef.current = () => document.removeEventListener('visibilitychange', onVisibility);
  }, [vehicleId, tryWatch, sendPosition, drainQueue, addAlert, processCoords]);

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
    if (nativeSubscriptionRef.current) {
      nativeSubscriptionRef.current.unsubscribe();
      nativeSubscriptionRef.current = null;
    }
    stopBackgroundLocation().catch(() => {});
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
    socket.on('proximityAlert', (alert: { type: string; urgency?: 'normal' | 'high' | 'critical'; title?: string; message: string; deliveryId?: string; escalationLevel?: number }) => {
      if (alert.type === 'proximity' && usesPhysicalTrackerRef.current) {
        const urgency = alert.urgency || 'normal';
        addAlert({
          type: 'proximity',
          title: alert.title || 'Livraison',
          message: alert.message,
          deliveryId: alert.deliveryId,
          urgency,
          escalationLevel: alert.escalationLevel,
        });
      }
    });
    const onOnline = () => { drainQueue(); };
    window.addEventListener('online', onOnline);

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      if (drainIntervalRef.current !== null) clearInterval(drainIntervalRef.current);
      if (nativeSubscriptionRef.current) {
        nativeSubscriptionRef.current.unsubscribe();
        nativeSubscriptionRef.current = null;
      }
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
