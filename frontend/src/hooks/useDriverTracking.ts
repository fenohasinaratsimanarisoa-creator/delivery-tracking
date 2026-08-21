import { useEffect, useRef, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api/client';
import { getSocket, onSocketSessionExpired } from '../services/socket/socket';
import { getAccessToken } from '../services/auth/tokenStore';
import { getSocketBaseUrl } from '../services/api/config';
import { enqueuePosition, queueSize, flushQueue, QUEUE_WARN_SIZE } from '../services/offlineQueue';
import { KalmanFilter } from '../services/tracking/KalmanFilter';
import { sensorFusion, simulateStationaryFromSpeed } from '../services/tracking/sensorFusion';
import {
  getBackgroundLocationStatus,
  getBatteryOptimizationStatus,
  getDeviceOemInfo,
  getNativeInterruptionInfo,
  openOemBatterySettings,
  requestBackgroundLocationPermissions,
  requestBatteryOptimizationExemption,
  startBackgroundLocation,
  stopBackgroundLocation,
  subscribeToNativeBatteryCritical,
  subscribeToNativeLocations,
  updateNativeTrackingStatus,
  storeNativeFallbackToken,
  storeNativeFallbackApiUrl,
  markNativeJsAck,
  setNativeTrackingContext,
  type DeviceOemInfo,
} from '../services/tracking/backgroundLocation';
import { Network } from '@capacitor/network';
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
// Seuil UI "signal GPS faible" (badge) : DÉDIÉ, volontairement plus proche de
// l'usage réel que ACCURACY_MODERATE (30m). En conditions réelles (rue, sous
// couvert, en ville), un téléphone Android donne très souvent 20-50m — normal
// et parfaitement exploitable pour du tracking de livraison (le seuil de rejet
// réel d'une position est ACCURACY_REJECT = 80m). Le badge ne s'affiche donc
// qu'au-dessus de 50m, aligné sur la branche d'alerte "GPS très faible"
// (ACCURACY_POOR), au lieu de se déclencher dès 30m.
const UI_POOR_ACCURACY_THRESHOLD = 50;
// Nombre de fixes CONSÉCUTIFS au-dessus du seuil avant d'afficher le badge :
// un pic isolé de bruit GPS (arbre, bus, passage couvert) ne doit pas faire
// clignoter le badge à chaque fix.
const UI_POOR_ACCURACY_FIXES_REQUIRED = 3;
const SPEED_MOVING_THRESHOLD_MS = 1.39;
const STOPPED_DURATION_MS = 30_000;
// Cadence d'envoi en mouvement : 3s. Alignée sur le LOCATION_INTERVAL_MS natif
// (LocationForegroundService.java = 3000L) pour un rendu temps réel fluide.
const INTERVAL_FAST = 3000;
const INTERVAL_SLOW = 20000;
const INTERVAL_DEFAULT = 5000;
// Cadence minimale entre deux envois de position, cohérente avec la cadence native
// définie côté LocationForegroundService.java (LOCATION_FASTEST_INTERVAL_MS = 2000).
// Protège contre la sur-fréquence quand l'intervalle ET le callback natif envoient tous
// les deux en premier plan : le throttling de Chromium ne s'applique qu'en arrière-plan,
// en premier plan les deux sources peuvent cohabiter → on borne le débit d'envoi.
// Reste sous l'intervalle nominal (3000ms) : l'écart autorise les fixes natifs remontés
// plus souvent (LOCATION_FASTEST_INTERVAL_MS natif) sans jamais descendre sous 2s.
const LOCATION_FASTEST_INTERVAL_MS = 2000;
const DRAIN_INTERVAL_MS = 10000;
const PROXIMITY_THRESHOLD_M = 300;
const PROXIMITY_REMINDER_MS = 5 * 60 * 1000;
const SNOOZE_MS = 5 * 60 * 1000;
const ESCALATION_AFTER_MS = 15 * 60 * 1000;
const ESCALATION_SNOOZE_MS = 2 * 60 * 1000;
const QUEUE_WARN_THRESHOLD = 50;
// Taille maximale d'un chunk de positions envoyé par batchPosition. Longue
// coupure réseau = plusieurs milliers de positions en file : un lot unique
// surdimensionné dépassait le timeout d'ACK serveur (5s) et était rejoué en
// boucle sans jamais être purgé. Chaque chunk est acquitté SÉPARÉMENT
// (positionsSaved) avant l'envoi du suivant.
const BATCH_CHUNK_SIZE = 250;

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
  type: 'proximity' | 'cascade' | 'geofence' | 'poor_accuracy' | 'queue_full' | 'queue_near_full' | 'geo_denied' | 'background_continued' | 'battery_critical';
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
  degradedAccuracyWhileMoving: number;
  isStationary: boolean;
  queueCount: number;
  /** true = socket temps réel connecté (le dispatcher reçoit les positions en direct). */
  socketConnected: boolean;
  /** true = le téléphone a du réseau (navigator.onLine + événements online/offline). */
  networkOnline: boolean;
  /** true = le serveur a révoqué/rejeté la session et le refresh a échoué → reconnexion manuelle requise. */
  sessionExpired: boolean;
  statusMsg: string;
  geolocationDenied: boolean;
  activeDeliveryId: string;
  alerts: DriverAlert[];
  dismissAlert: (type: string, deliveryId?: string) => void;
  batteryOptimizationIgnored: boolean;
  requestBatteryExemption: () => Promise<void>;
  /** Marque du téléphone détectée (surcouches agressives) pour le guide de réglages manuels. */
  deviceOem: DeviceOemInfo | null;
  /** Ouvre l'écran système "démarrage automatique" propre à la marque (repli : détails app). */
  openOemSettings: () => Promise<void>;
}

export function useDriverTracking() {
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState(1);
  const [poorAccuracy, setPoorAccuracy] = useState(false);
  const [isStationary, setIsStationary] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [geolocationDenied, setGeolocationDenied] = useState(false);
  // État persistant de l'exemption d'optimisation batterie (Android). Défaut true sur
  // iOS/web (pas de Doze) ; relu au démarrage du tracking puis à chaque retour au premier
  // plan pour masquer la bannière dès que le chauffeur accorde l'exemption.
  const [batteryOptimizationIgnored, setBatteryOptimizationIgnored] = useState(true);
  const [socketConnected, setSocketConnected] = useState(false);
  // État réseau réel du téléphone (navigator.onLine + événements 'online'/'offline',
  // même pattern que drainQueue) : distingue "pas de réseau" de "socket déconnecté"
  // dans le badge de statut.
  const [networkOnline, setNetworkOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
  );
  // Session révoquée côté serveur (refresh échoué après 'Invalid token' du socket) :
  // le badge affiche "Session expirée — reconnexion nécessaire" au lieu de boucler
  // sur un "Hors ligne" générique.
  const [sessionExpired, setSessionExpired] = useState(false);
  const [deviceOem, setDeviceOem] = useState<DeviceOemInfo | null>(null);
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
  const batterySubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hiddenSinceRef = useRef<number>(0);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  const drainIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMovingRef = useRef<number>(Date.now());
  const intervalDurationRef = useRef<number>(INTERVAL_DEFAULT);
  // Compteur de cas où un véhicule EN MOUVEMENT émet avec une précision dégradée
  // (ACCURACY_MODERATE < acc < ACCURACY_REJECT) : la fréquence d'envoi reste
  // INTERVAL_FAST (choix documenté dans recalcInterval), on trace simplement ces cas
  // pour le débogage terrain. Exposé en lecture dans trackingStatus.
  const degradedAccuracyWhileMovingRef = useRef(0);
  // Compteur de fixes CONSÉCUTIFS au-dessus de UI_POOR_ACCURACY_THRESHOLD : le badge
  // "GPS faible" ne s'affiche qu'à partir de UI_POOR_ACCURACY_FIXES_REQUIRED fixes
  // consécutifs (évite le clignotement sur un pic isolé de bruit GPS).
  const poorAccuracyStreakRef = useRef(0);
  const posRef = useRef(position);
  const isSendingRef = useRef(false);
  // Horodatage du dernier envoi réellement initié (throttle minimal contre la
  // sur-fréquence intervalle + callback natif en premier plan, voir LOCATION_FASTEST_INTERVAL_MS).
  const lastSendTimeRef = useRef(0);
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
  // P1 : le geofence est diffusé sur la room company (tous les chauffeurs). On filtre
  // côté client pour ne garder que les événements du chauffeur courant (sinon chaque
  // chauffeur recevait les alertes zones des livraisons des autres).
  const driverIdRef = useRef<string>('');
  driverIdRef.current = driver?.id || '';
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

  const refreshBatteryOptimizationStatus = useCallback(async () => {
    try {
      const { batteryOptimizationIgnored: ignored } = await getBatteryOptimizationStatus();
      setBatteryOptimizationIgnored(ignored);
    } catch {
      // Neutral : sur iOS/web ou plugin indisponible, on garde l'état précédent.
    }
  }, []);

  const requestBatteryExemption = useCallback(async () => {
    try {
      await requestBatteryOptimizationExemption();
      await refreshBatteryOptimizationStatus();
    } catch {
      // L'utilisateur a pu fermer l'écran système sans réponse exploitable → on
      // relit l'état réel au retour (voir refreshBatteryOptimizationStatus via visibilitychange).
    }
  }, [refreshBatteryOptimizationStatus]);

  const openOemSettings = useCallback(async () => {
    try {
      // Ouvre l'écran constructeur (autostart / gestion arrière-plan) ; au retour,
      // on relit l'état batterie + l'info OEM (le visibilitychange le rafraîchit aussi).
      await openOemBatterySettings();
      await refreshBatteryOptimizationStatus();
    } catch {
      // Échec d'ouverture : silencieux, la bannière OEM reste visible.
    }
  }, [refreshBatteryOptimizationStatus]);

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
          // Timeout d'ACK PROPORTIONNEL à la taille du chunk envoyé (jamais un
          // délai fixe) : un petit lot est traité vite côté serveur, un gros chunk
          // mérite un budget plus large. Base 5s, +15ms par position — pour un
          // chunk complet de 250, le budget est bien au-dessus du temps de
          // traitement serveur (validation parallèle). Le timeout n'est qu'un
          // filet de sécurité : en cas de déclenchement, l'échec remonte à
          // flushQueue qui n'affiche rien de non-acquitté (reprise au tick suivant).
          const timeoutMs = Math.max(5000, positions.length * 15);
          const timeout = setTimeout(() => {
            // Retire le listener restant : un 'positionsSaved' tardif (ex. d'un flush
            // suivant) ne doit pas résoudre une promesse déjà rejetée, ni fuiter.
            socket.off('positionsSaved', onPositionsSaved);
            reject(new Error(`flush timeout (${positions.length} positions)`));
            // Le backend émet désormais positionsSaved EXPLICITEMENT (acquittement
            // réel, sans callback ack côté client) : le timeout n'est plus qu'un filet
            // de sécurité réseau. L'échec réel (timeout) ne supprime PAS les positions
            // de la file IndexedDB : flushQueue ne les efface que si sendFn résout.
          }, timeoutMs);
          socket.once('positionsSaved', onPositionsSaved);
        });
      }, { chunkSize: BATCH_CHUNK_SIZE });
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

    // Construit le payload d'une position à partir de la position courante : les
  // coordonnées BRUTES (rawPosRef, fournies par processCoords) partent au backend
  // (le filtre Kalman ne sert qu'à l'affichage), avec vehicleId/deliveryId du
  // contexte courant. Partagé par le chemin d'envoi direct et le chemin de mise
  // en file (garde isSendingRef) pour que les deux produisent des données
  // strictement identiques.
  const buildPositionPayload = useCallback((p: DriverPosition): Record<string, unknown> => {
    const dId = deliveryIdRef.current;
    const vId = vehicleId;
    const raw = rawPosRef.current;
    const sendLat = raw ? raw.lat : p.lat;
    const sendLng = raw ? raw.lng : p.lng;

    const payload: Record<string, unknown> = {
      latitude: sendLat, longitude: sendLng,
      speed: p.speed ?? undefined, heading: p.heading,
      altitude: p.altitude, accuracy: p.accuracy ?? 50,
      timestamp: new Date().toISOString(),
    };
    if (vId) payload.vehicleId = vId;
    if (dId) payload.deliveryId = dId;
    return payload;
  }, [vehicleId]);

  // Mise en file locale UNIFIÉE : stocke la position (IndexedDB persistante).
  // STRATÉGIE SANS PERTE sur les coupures longues (voir offlineQueue.ts) :
  // - près de 80 % du quota → alerte précoce (nearCapacity), bien avant la saturation ;
  // - à saturation, les positions anciennes sont COMPACTÉES (1 point / 45 s,
  //   la trace reste complète) avant toute éviction ;
  // - une éventuelle éviction du plus ancien est TOUJOURS signalée (droppedOldest
  //   → alerte critique) — jamais de perte silencieuse de données de trajet.
  const queuePosition = useCallback(async (payload: Record<string, unknown>) => {
    try {
      const res = await enqueuePosition(payload);
      if (res.nearCapacity) {
        addAlert({
          type: 'queue_near_full',
          title: 'File de positions presque pleine',
          message: `La file locale a dépassé 80 % de sa capacité (${QUEUE_WARN_SIZE} positions). Une coupure prolongée va saturer : vérifiez votre connexion réseau dès que possible.`,
          urgency: 'high',
        });
      } else {
        removeAlert('queue_near_full', '');
      }
      if (res.droppedOldest) {
        addAlert({
          type: 'queue_full',
          title: 'File de positions saturée',
          message: 'La file locale a atteint sa limite alors que toutes les positions sont récentes : une position très ancienne a dû être remplacée. Vérifiez la connexion réseau dès que possible pour éviter toute perte de trajet.',
          urgency: 'critical',
        });
      }
    } catch {
      // Échec IndexedDB (stockage plein) : non bloquant, la position sera re-tentée
      // au prochain tick — on ne casse pas le pipeline GPS pour un enregistrement local.
    } finally {
      refreshQueueCount();
    }
  }, [addAlert, refreshQueueCount, removeAlert]);

  const sendPosition = useCallback(() => {
    const p = posRef.current;
    if (!p) return;

    // Position acquise alors qu'on ne PEUT PAS l'envoyer immédiatement (envoi
    // déjà en cours, ou fenêtre de throttle non écoulée) : on NE la jette PAS
    // (les return silencieux d'avant perdaient des positions — sous-comptage de
    // distance jusqu'à 80-90% quand l'ACK n'arrivait jamais). Elle est mise en
    // file locale (IndexedDB) et sera retentée par drainQueue.
    const queueAndSkip = (pos: DriverPosition) => {
      void queuePosition(buildPositionPayload(pos));
    };

    if (isSendingRef.current) {
      queueAndSkip(p);
      return;
    }

    const acc = p.accuracy ?? 50;
    if (acc >= ACCURACY_REJECT) {
      // P1 : avant, on JETAIT la position (return silencieux) malgré une accuracy que
      // le backend tolère (DTO jusqu'à 1000m, téléportation modulée par accuracy). En
      // zone urbaine dense (fixes 80-150m), la trace avait des trous et la distance/ETA
      // étaient faussés. On la met en file (envoyée telle quelle, le serveur décide du
      // suspect) au lieu de la perdre.
      // NB : le badge "GPS faible" (poorAccuracy) est géré exclusivement par
      // processCoords — pas de setPoorAccuracy ici, pour ne pas court-circuiter le
      // décompte de fixes consécutifs (UI_POOR_ACCURACY_FIXES_REQUIRED).
      queueAndSkip(p);
      return;
    }

    // Throttle minimal : ne pas initier un envoi si le dernier date de moins de
    // LOCATION_FASTEST_INTERVAL_MS. En arrière-plan Chromium throttle déjà les timers,
    // mais en PREMIER PLAN l'intervalle ET le callback natif peuvent tous deux appeler
    // sendPosition → ce garde borne le débit (3s), cohérent avec la cadence native.
    const nowTs = Date.now();
    if (nowTs - lastSendTimeRef.current < LOCATION_FASTEST_INTERVAL_MS) {
      // Même traitement que le garde isSendingRef : la position n'est pas
      // silencieusement perdue, elle est mise en file (IndexedDB) et retentée par
      // drainQueue. On ne met PAS à jour lastSendTimeRef : seule l'initiation
      // réelle d'un envoi renouvelle la fenêtre de throttle.
      queueAndSkip(p);
      return;
    }
    lastSendTimeRef.current = nowTs;
    isSendingRef.current = true;

    const payload = buildPositionPayload(p);
    const socket = getSocket();
    if (socket.connected) {
      socket.emit('updatePosition', payload);
      // Filet de sécurité ANTI-CONNEXION ZOMBIE : socket.connected peut rester
      // true alors que le TCP est mort (changement d'interface Wi-Fi ↔ mobile).
      // Si NI positionSaved NI positionRejected n'arrivent dans les 2000ms, la
      // position est RÉACQUÉE en file locale exactement comme une déconnexion
      // — jamais perdue silencieusement. Le garde settled + le cleanup des
      // listeners évitent tout double traitement si un ACK arrive après coup.
      let settled = false;
      let onSaved: () => void = () => {};
      let onRejected: (data?: { reason?: string }) => void = () => {};
      const cleanup = () => {
        socket.off('positionSaved', onSaved);
        socket.off('positionRejected', onRejected);
      };
      const posTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        isSendingRef.current = false;
        void queuePosition(payload);
      }, 2000);
      onSaved = () => {
        if (settled) return;
        settled = true;
        clearTimeout(posTimeout);
        cleanup();
        isSendingRef.current = false;
        // Drainage immédiat en mode dégradé (file non vide) : le timer drainIntervalRef
        // est throttlé par Chromium en arrière-plan comme setInterval ; un envoi direct
        // réussi est l'occasion de purger la file sans attendre le prochain tick.
        void drainQueue();
      };
      onRejected = (data) => {
        if (settled) return;
        settled = true;
        clearTimeout(posTimeout);
        cleanup();
        if (data?.reason === 'invalid_payload') {
          // Payload définitivement malformé (lat/lng hors bornes, timestamp
          // illisible, vehicleId inconnu) : le remettre en file enverrait la
          // même position invalide en boucle (le batch serveur la filtrerait
          // de toute façon). On la jette explicitement et on libère isSendingRef.
          isSendingRef.current = false;
          return;
        }
        void queuePosition(payload).then(() => { isSendingRef.current = false; });
      };
      socket.once('positionSaved', onSaved);
      socket.once('positionRejected', onRejected);
    } else {
      void queuePosition(payload).then(() => { isSendingRef.current = false; });
    }
  }, [vehicleId, refreshQueueCount, drainQueue, buildPositionPayload, queuePosition]);

  const recalcInterval = useCallback((speed: number | undefined, accuracy?: number, stationary?: boolean) => {
    const now = Date.now();
    if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) lastMovingRef.current = now;
    let ni: number;
    const isStationaryNow = stationary === true || (speed !== undefined && speed < 0.1);
    if (speed !== undefined && speed > SPEED_MOVING_THRESHOLD_MS) {
      // Choix retenu — l'ancien ternaire (`accuracy ... ? INTERVAL_FAST : INTERVAL_FAST`)
      // était du code mort : les deux branches valaient INTERVAL_FAST. On ne ralentit
      // PAS l'envoi d'un véhicule en mouvement, quelle que soit sa précision : tant
      // qu'une position est envoyable (acc < ACCURACY_REJECT, garanti par sendPosition
      // qui rejette acc >= ACCURACY_REJECT), un véhicule prioritaire doit rester en
      // INTERVAL_FAST (3s) pour ne pas dégrader le suivi temps réel du dispatcher.
      // Une précision moyenne (ACCURACY_MODERATE < acc < ACCURACY_REJECT) n'est PAS un
      // motif de réduction de fréquence — on la trace simplement via le compteur
      // degradedAccuracyWhileMoving. Le signal d'alerte `poorAccuracy` reste géré
      // exclusivement par processCoords (aucun doublon de logique ici).
      if (accuracy !== undefined && accuracy > ACCURACY_MODERATE && accuracy < ACCURACY_REJECT) {
        degradedAccuracyWhileMovingRef.current++;
      }
      ni = INTERVAL_FAST;
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
    } else {
      kalmanRef.current.predict();
    }
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
    // Mise à jour SYNCHRONE de posRef : le callback natif appelle sendPosition()
    // immédiatement après processCoords() — sans ceci, sendPosition lirait la position
    // du RENDU précédent (posRef.current = position n'est rafraîchi qu'au re-render),
    // donc une donnée périmée voire nulle au premier fix.
    posRef.current = p;
    setConfidenceLevel(conf);
    setIsStationary(isActuallyStationary);
    recalcInterval(speed ?? undefined, acc, isActuallyStationary);
    checkProximity(filtered.lat, filtered.lng);

    // Badge "signal GPS faible" : seuil UI dédié (50m, voir UI_POOR_ACCURACY_THRESHOLD)
    // ET persistance sur plusieurs fixes consécutifs — un pic isolé de bruit GPS
    // (arbre, bus, passage couvert) ne doit pas faire clignoter le badge à chaque fix.
    // Les alertes (GPS faible / très faible) restent sur les seuils historiques.
    const poorFix = acc > UI_POOR_ACCURACY_THRESHOLD;
    poorAccuracyStreakRef.current = poorFix ? poorAccuracyStreakRef.current + 1 : 0;
    const showPoorAccuracy = poorAccuracyStreakRef.current >= UI_POOR_ACCURACY_FIXES_REQUIRED;

    if (acc <= ACCURACY_GOOD) {
      setStatusMsg('');
      setPoorAccuracy(false);
      removeAlert('poor_accuracy', '');
    } else if (acc <= ACCURACY_MODERATE) {
      setStatusMsg('');
      setPoorAccuracy(false);
      removeAlert('poor_accuracy', '');
    } else if (acc <= ACCURACY_POOR) {
      setPoorAccuracy(showPoorAccuracy);
      addAlert({ type: 'poor_accuracy', title: 'GPS faible', message: `La précision GPS est faible (±${Math.round(acc)}m). Déplacez-vous dans une zone dégagée.`, urgency: 'normal' });
    } else {
      setPoorAccuracy(showPoorAccuracy);
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
    poorAccuracyStreakRef.current = 0;
    kalmanRef.current = null;
    filteredPosRef.current = null;

    // --- Fallback HTTP natif : initialiser le contexte véhicule/livraison ---
    setNativeTrackingContext(vehicleId, autoDeliveryId).catch(() => {});

    sensorFusion.init().then(() => {}).catch(() => {});

    // État batterie lu au démarrage pour afficher la bannière d'exemption persistante
    // tant que batteryOptimizationIgnored === false (rafraîchi aussi au retour premier plan).
    refreshBatteryOptimizationStatus();

    // Détection de la marque (surcouches agressives : MIUI, EMUI, ColorOS, Vivo…) :
    // le guide de réglages manuels est affiché en fonction (voir BatterySetupGuide).
    getDeviceOemInfo().then((info) => {
      setDeviceOem(info);
      setBatteryOptimizationIgnored(info.batteryOptimizationIgnored);
    }).catch(() => {});

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

    // --- Fallback HTTP natif (Option B, audit 21/08/2026) ---
    // Stocke le token et l'URL API dans SharedPreferences natifs pour que
    // NativeHttpFallback puisse envoyer des positions quand la WebView est gelée.
    const currentToken = getAccessToken();
    if (currentToken) {
      storeNativeFallbackToken(currentToken).catch(() => {});
    }
    storeNativeFallbackApiUrl(getSocketBaseUrl()).catch(() => {});

    // DÉTECTION D'INTERRUPTION RÉSIDUELLE (force-stop, service tué) : le marqueur
    // natif (SharedPreferences, écrit par le watchdog ou onDestroy non-volontaire)
    // est lu au lancement. Si un tracking actif a été interrompu pendant une
    // livraison, on le signale IMMÉDIATEMENT au backend → notification dashboard
    // "Chauffeur X : tracking interrompu à HH:MM" (jamais un silence découvert
    // a posteriori). Le marqueur est effacé côté natif à la lecture : chaque
    // interruption n'est signalée qu'une fois.
    getNativeInterruptionInfo()
      .then((interruption) => {
        if (!interruption.interruptedAt || !deliveryIdRef.current) return;
        const dId = deliveryIdRef.current;
        const vId = vehicleId;
        api.post('/tracking/report-interruption', {
          interruptedAt: new Date(interruption.interruptedAt).toISOString(),
          reason: interruption.reason ?? 'unknown',
          deliveryId: dId,
          ...(vId ? { vehicleId: vId } : {}),
        })
          .then(() => {
            const time = new Date(interruption.interruptedAt!).toLocaleTimeString('fr-FR', {
              hour: '2-digit', minute: '2-digit',
            });
            addAlert({
              type: 'background_continued',
              title: 'Tracking interrompu puis relancé',
              message: `Le suivi a été interrompu à ${time} (app fermée manuellement ou tuée par le système). Le dispatcher en a été informé.`,
              urgency: 'high',
            });
          })
          .catch(() => {
            // Échec réseau au lancement : le marqueur natif est déjà effacé, on ne
            // peut pas re-tenter sans le conserver — cas rare, le moniteur de
            // silence serveur (5 min) couvre la détection de toute façon.
          });
      })
      .catch(() => {});

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
    //
    // Différence clé avec watchPosition : quand document.visibilityState === 'hidden'
    // (écran verrouillé), Chromium THROTTLE les timers JS (setInterval(sendPosition, ni))
    // indépendamment du foreground service natif, qui ne maintient que le PROCESS vivant.
    // Les positions natives doivent donc déclencher leur propre envoi direct ici, sans
    // attendre le prochain tick de l'intervalle. isSendingRef + lastSendTimeRef protègent
    // contre la sur-fréquence quand intervalle et callback natif cohabitent en premier plan.
    subscribeToNativeLocations((nativePos) => {
      processCoords({
        latitude: nativePos.latitude,
        longitude: nativePos.longitude,
        speed: nativePos.speed,
        heading: nativePos.heading,
        altitude: nativePos.altitude,
        accuracy: nativePos.accuracy,
      });
      sendPosition(); // envoi immédiat, ne dépend plus du timer throttlé
      // Notifie le fallback natif que le JS traite les positions (reset du timer de silence).
      markNativeJsAck().catch(() => {});
    })
      .then((sub) => {
        nativeSubscriptionRef.current = sub;
      })
      .catch(() => {});

    // BATTERIE CRITIQUE (niveau ≤ 20 %, émis par le foreground service natif) :
    // avant extinction probable, on envoie au backend une dernière position + un
    // statut explicite, pour que le dispatcher voie la CAUSE probable de
    // l'interruption au lieu d'un silence inexpliqué. Alerte aussi le chauffeur.
    subscribeToNativeBatteryCritical((batteryEvent) => {
      const socket = getSocket();
      const vId = vehicleId;
      const dId = deliveryIdRef.current;
      if (vId && socket.connected) {
        socket.emit('batteryCritical', {
          vehicleId: vId,
          ...(dId ? { deliveryId: dId } : {}),
          level: batteryEvent.level,
          latitude: batteryEvent.latitude,
          longitude: batteryEvent.longitude,
          timestamp: batteryEvent.timestamp ?? Date.now(),
        });
      }
      addAlert({
        type: 'battery_critical',
        title: 'Batterie critique',
        message: `Batterie à ${batteryEvent.level}%. Le suivi va s'interrompre si le téléphone s'éteint. Le dispatcher en a été informé.`,
        urgency: 'critical',
      });
      updateNativeTrackingStatus(`⚠ Batterie ${batteryEvent.level}% — suivi va s'interrompre`).catch(() => {});
    })
      .then((sub) => {
        batterySubscriptionRef.current = sub;
      })
      .catch(() => {});


    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
      } else if (document.visibilityState === 'visible') {
        // Au retour au premier plan (après l'écran système de demande d'exemption batterie,
        // ou les Paramètres constructeur type MIUI), relit l'état réel pour masquer la
        // bannière dès que l'utilisateur a accordé l'exemption.
        refreshBatteryOptimizationStatus();
        if (hiddenSinceRef.current > 0) {
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
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    visibilityHandlerRef.current = () => document.removeEventListener('visibilitychange', onVisibility);
  }, [vehicleId, tryWatch, sendPosition, drainQueue, addAlert, processCoords, refreshBatteryOptimizationStatus]);

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
    if (batterySubscriptionRef.current) {
      batterySubscriptionRef.current.unsubscribe();
      batterySubscriptionRef.current = null;
    }
    stopBackgroundLocation().catch(() => {});
    // Réinitialise le statut de la notification (le service s'arrête de toute façon,
    // mais on s'assure qu'aucun texte périmé ne traîne si un redémarrage survient).
    updateNativeTrackingStatus('').catch(() => {});
    releaseWakeLock();
    hiddenSinceRef.current = 0;
    lastMovingRef.current = Date.now();
    intervalDurationRef.current = INTERVAL_DEFAULT;
    poorAccuracyStreakRef.current = 0;
    setPosition(null);
    setQueueCount(0);
    setPoorAccuracy(false);
    setStatusMsg('');
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const updateConnState = () => {
      setSocketConnected(socket.connected);
      // Une reconnexion réussie avec un jeton VALIDE lève l'état sessionExpired.
      if (socket.connected) setSessionExpired(false);
    };
    updateConnState();
    socket.on('connect', updateConnState);
    socket.on('disconnect', updateConnState);
    socket.on('connect', drainQueue);
    // Session révoquée par le serveur (refresh échoué après 'Invalid token') :
    // le badge affiche "Session expirée — reconnexion nécessaire" au lieu d'un
    // "Hors ligne" générique qui boucle en silence.
    const unsubSessionExpired = onSocketSessionExpired(() => setSessionExpired(true));
    socket.on('dataUpdate', (event: { entity: string; action: string; geofenceName: string; deliveryId?: string; driverId?: string }) => {
      if (event.entity === 'geofence_event' && event.driverId && event.driverId === driverIdRef.current) {
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
    const onOnline = () => { setNetworkOnline(true); drainQueue(); };
    const onOffline = () => { setNetworkOnline(false); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Détection réseau RÉELLE via Capacitor Network (Android : ConnectivityManager,
    // pas la WebView). C'est le seul canal qui reflète le changement d'interface
    // WiFi ↔ données mobiles : au retour en ligne (ou changement d'interface), la
    // socket existante peut être zombie (TCP mort sur l'ancienne interface) alors
    // que socket.connected vaut encore true — on force une reconnexion PROPRE,
    // PAS conditionnelle à socket.connected (c'est justement cette valeur qui
    // ment). Le listener window online/offline ci-dessus reste en repli multi-
    // plateforme (web/navigateur).
    let netRemoved = false;
    let netListener: { remove: () => void } | null = null;
    void Network.addListener('networkStatusChange', (status: { connected: boolean }) => {
      setNetworkOnline(status.connected);
      if (status.connected) {
        const s = getSocket();
        s.disconnect();
        s.connect();
        void drainQueue();
      }
    }).then((handle) => {
      if (netRemoved) {
        handle.remove();
      } else {
        netListener = handle;
      }
    });

    // --- Garde-fou temporel (Prompt 2, audit 21/08/2026) ---
    // Filet de sécurité indépendant de l'événement Network : si le socket
    // reste déconnecté pendant > 20s alors que le réseau est OK (networkOnline
    // true), on force un cycle disconnect()+connect(). Se déclenche UNE fois
    // par fenêtre de 20s (cooldown) pour éviter une boucle agressive.
    // Utile quand l'event networkStatusChange ne se déclenche pas (certains
    // OEM Android rapportent connected:true en continu pendant le handover
    // WiFi→Data).
    const WATCHDOG_INTERVAL_MS = 5_000; // vérification toutes les 5s
    const WATCHDOG_THRESHOLD_MS = 20_000; // déclenchement après 20s consécutives
    let watchdogDisconnectedSince = 0;
    let watchdogLastTrigger = 0;
    const watchdogTimer = setInterval(() => {
      const s = getSocket();
      const isOnline = networkOnline;
      if (!s.connected && isOnline) {
        if (watchdogDisconnectedSince === 0) {
          watchdogDisconnectedSince = Date.now();
        }
        const elapsed = Date.now() - watchdogDisconnectedSince;
        if (elapsed >= WATCHDOG_THRESHOLD_MS && Date.now() - watchdogLastTrigger >= WATCHDOG_THRESHOLD_MS) {
          watchdogLastTrigger = Date.now();
          watchdogDisconnectedSince = 0; // reset pour la prochaine fenêtre
          console.warn(
            `[tracking] watchdog reconnect: socket déconnecté depuis ${Math.round(elapsed / 1000)}s alors que le réseau est OK — tentative de reconnexion forcée`,
          );
          s.disconnect();
          s.connect();
          void drainQueue();
        }
      } else if (s.connected) {
        watchdogDisconnectedSince = 0; // reset si reconnecté
      }
    }, WATCHDOG_INTERVAL_MS);

    return () => {
      clearInterval(watchdogTimer);
      netRemoved = true;
      if (netListener) netListener.remove();
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
      if (drainIntervalRef.current !== null) clearInterval(drainIntervalRef.current);
      if (nativeSubscriptionRef.current) {
        nativeSubscriptionRef.current.unsubscribe();
        nativeSubscriptionRef.current = null;
      }
      if (batterySubscriptionRef.current) {
        batterySubscriptionRef.current.unsubscribe();
        batterySubscriptionRef.current = null;
      }
      unsubSessionExpired();
      socket.off('connect', updateConnState);
      socket.off('disconnect', updateConnState);
      socket.off('connect', drainQueue);
      socket.off('dataUpdate');
      socket.off('proximityAlert');
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [drainQueue, addAlert]);

  // Indicateur utilisateur (PARTIE 1, point 5) : l'état RÉEL du tracking est poussé
  // dans la notification persistante du foreground service (visible sans ouvrir
  // l'app, même écran verrouillé) à chaque changement de connexion / file locale :
  // actif en ligne / hors ligne avec file locale / synchronisation en cours.
  // Le même état alimente l'indicateur dans l'app (LivePill via socketConnected).
  useEffect(() => {
    if (!startedRef.current) return;
    let text: string;
    if (socketConnected && queueCount === 0) {
      text = 'Suivi actif — en ligne';
    } else if (!socketConnected && queueCount > 0) {
      text = `Hors ligne — ${queueCount} position${queueCount > 1 ? 's' : ''} en attente`;
    } else if (!socketConnected) {
      text = 'Hors ligne — reconnexion…';
    } else {
      text = `Synchronisation — ${queueCount} position${queueCount > 1 ? 's' : ''}…`;
    }
    updateNativeTrackingStatus(text).catch(() => {});
  }, [socketConnected, queueCount, startedRef]);

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
    degradedAccuracyWhileMoving: degradedAccuracyWhileMovingRef.current,
    isStationary,
    queueCount,
    socketConnected,
    networkOnline,
    sessionExpired,
    statusMsg,
    geolocationDenied,
    activeDeliveryId,
    alerts,
    dismissAlert,
    batteryOptimizationIgnored,
    requestBatteryExemption,
    deviceOem,
    openOemSettings,
  };

  return trackingStatus;
}
