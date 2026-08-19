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
import { computeAnimationDuration, FALLBACK_ANIMATION_MS } from './animationTiming';

import MapLayerSwitcher from '../../components/MapLayerSwitcher';
import { enableRetinaDefaultMarker } from './markerIcons';
import styles from './RealTimeMap.module.css';

// Marqueur Leaflet par défaut (utilisé par les popups/marqueurs sans icône
// explicite) en version @2x sur écrans HiDPI — plus de PNG 1x étiré en flou.
enableRetinaDefaultMarker();

// Flèche directionnelle vue du dessus (type Google Maps) : SVG VECTORIEL, net à
// toute taille/zoom et sur tout écran (pas d'emoji → rendu identique sur tous
// les OS, anticrénelage maîtrisé). Rotation native selon le cap du véhicule via
// `transform: rotate(...)` appliqué sur l'élément. Contour blanc + ombre portée
// pour rester lisible sur toute couche de tuiles (clair/sombre/satellite).
const VEHICLE_ARROW_PATH = 'M12 1.5 L20.1 11.9 L14.2 11 L14.2 22.5 L9.8 22.5 L9.8 11 L3.9 11.9 Z';
const VEHICLE_ARROW_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="${VEHICLE_ARROW_PATH}" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><path d="${VEHICLE_ARROW_PATH}" fill="currentColor"/></svg>`;

// Les couleurs de polyligne passent par un attribut SVG (`stroke`), qui ne
// résout PAS les var() CSS : on résout le token à l'exécution (même pattern
// que TripReplayPage/DeliveryDetailPage), fallback sur les anciens hex.
function themeColor(varName: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
  } catch {
    return fallback;
  }
}
const ROUTE_RECALC_MIN_DELAY_MS = 15000;
const ROUTE_RECALC_MIN_DISTANCE_M = 200;
const ROUTE_RECALC_INTERVAL_MS = 30000;

// Icône véhicule UNIQUE et statique : la structure (halo + flèche) ne change
// jamais. Toutes les variations (rotation, couleur, confiance, mouvement/arrêt,
// focus) sont appliquées par syncVehicleMarker sur l'élément existant (styles
// inline + classes) — sans recréer l'icône, ce qui redémarrait l'animation CSS
// du halo à chaque fix GPS (scintillement visuel).
function createVehicleIcon(): L.DivIcon {
  return L.divIcon({
    className: 'dt-marker-vehicle',
    html: `<div class="dt-marker-halo"></div><div class="dt-marker-icon">${VEHICLE_ARROW_SVG}</div>`,
    iconSize: [52, 52],
    iconAnchor: [26, 26],
  });
}

function syncVehicleMarker(marker: L.Marker, vehicle: VehicleData, focused: boolean) {
  const el = marker.getElement();
  if (!el) return;

  const isMoving = vehicle.status === 'moving';
  const confidence = vehicle.confidence ?? 1;
  // Couleurs pilotées par les tokens (var(--color-status-moving/static)) via
  // color-mix : le halo suit le thème clair/sombre/field sans hex en dur.
  const statusVar = isMoving ? 'var(--color-status-moving)' : 'var(--color-status-static)';
  const opacity = Math.max(0.15, Math.min(0.5, confidence * 0.5));
  const scale = 1 + (1 - confidence) * 0.5;

  el.classList.toggle('dt-marker-moving', isMoving);
  el.classList.toggle('dt-marker-static', !isMoving);
  el.classList.toggle('dt-marker-focus', focused);

  const halo = el.querySelector<HTMLElement>('.dt-marker-halo');
  if (halo) {
    halo.style.width = `${46 * scale}px`;
    halo.style.height = `${46 * scale}px`;
    halo.style.background = `color-mix(in srgb, ${statusVar} ${Math.round(opacity * 50)}%, transparent)`;
    halo.style.border = `${2 + confidence}px solid color-mix(in srgb, ${statusVar} ${Math.round(opacity * 100)}%, transparent)`;
    halo.style.animationDuration = `${2 - confidence * 0.5}s`;
  }

  const iconEl = el.querySelector<HTMLElement>('.dt-marker-icon');
  if (iconEl) {
    iconEl.style.color = statusVar;
    iconEl.style.transform = `rotate(${vehicle.heading ?? 0}deg)`;
  }
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

import type { VehicleData } from './vehicleMap';
import { mergePositionUpdate, mergeBootstrapPositions, shouldFollowRecenter, type FollowReference } from './vehicleMap';

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
  const durationRef = useRef<number>(FALLBACK_ANIMATION_MS);
  // Timestamp (epoch ms) de la position PRÉCÉDENTE reçue : c'est lui qui permet
  // de calculer le délai réel entre deux positions (computeAnimationDuration).
  const prevTsRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  const lastStateRef = useRef<{ lat: number; lng: number; speed: number; heading: number } | null>(null);
  const vehicleRef = useRef(vehicle);
  vehicleRef.current = vehicle;

  useEffect(() => {
    // Icône unique et statique — créée UNE fois : le rendu (halo, flèche,
    // rotation, couleur, confiance, focus) est ensuite piloté par
    // syncVehicleMarker sur l'élément existant, sans recréation d'icône.
    const marker = L.marker([vehicle.lat, vehicle.lng], { icon: createVehicleIcon(), zIndexOffset: focused ? 1000 : 0 }).addTo(map);
    syncVehicleMarker(marker, vehicle, !!focused);

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
  }, [vehicle.id, map]);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    cancelAnimationFrame(animRef.current);
    cancelAnimationFrame(drRef.current);

    // Rotation / couleur / confiance / mouvement-arrêt / focus : appliqués sur
    // l'élément existant (pas de setIcon → pas de redémarrage de l'animation
    // CSS du halo = pas de scintillement à chaque fix GPS).
    syncVehicleMarker(marker, vehicle, !!focused);
    marker.setZIndexOffset(focused ? 1000 : 0);

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
      fromRef.current = { lat: vehicle.lat, lng: vehicle.lng };
      return;
    }

    const startLat = from.lat;
    const startLng = from.lng;
    const endLat = vehicle.lat;
    const endLng = vehicle.lng;

    const dLat = endLat - startLat;
    const dLng = endLng - startLng;
    if (Math.abs(dLat) < 0.00001 && Math.abs(dLng) < 0.00001) {
      marker.setLatLng([endLat, endLng]);
      fromRef.current = { lat: endLat, lng: endLng };
      return;
    }

    // Durée d'animation = délai RÉEL entre la position reçue et la précédente
    // (timestamp à timestamp), borné au max pour ne jamais « rattraper » un long
    // gap de reconnexion. La vitesse d'interpolation visuelle correspond ainsi à
    // la vitesse réelle du véhicule, quelle que soit la source (natif/JS/batch).
    const currTs = vehicle.timestamp ? new Date(vehicle.timestamp).getTime() : null;
    const duration = computeAnimationDuration(prevTsRef.current, currTs);
    prevTsRef.current = currTs;
    startTimeRef.current = performance.now();
    durationRef.current = duration;

    function animate(time: number) {
      const elapsed = time - startTimeRef.current;
      const t = Math.min(elapsed / durationRef.current, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      const lat = startLat + dLat * ease;
      const lng = startLng + dLng * ease;
      marker!.setLatLng([lat, lng]);
      // La position courante interpolée devient le point de départ de la
      // prochaine animation : un update reçu en plein vol continue depuis ICI
      // au lieu de faire revenir le marqueur en arrière (« saut » visuel).
      fromRef.current = { lat, lng };

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      } else {
        marker!.setLatLng([endLat, endLng]);
        fromRef.current = { lat: endLat, lng: endLng };
      }
    }

    animRef.current = requestAnimationFrame(animate);
  }, [vehicle.lat, vehicle.lng, vehicle.id, disableAnimation, vehicle.status, vehicle.heading, vehicle.suspect, focused]);

  // Dead reckoning: extrapolate position when GPS update is delayed
  useEffect(() => {
    const maxDrMs = maxDeadReckonTime(vehicle.speed ?? 0);
    if (maxDrMs <= 0) return;

    const interval = setInterval(() => {
      const marker = markerRef.current;
      if (!marker) return;

      const elapsed = Date.now() - lastUpdateRef.current;
      // L'animation en cours couvre déjà le délai réel entre deux positions
      // (sa durée = delta timestamp à timestamp) : ne pas la court-circuiter
      // par une extrapolation. Le dead reckoning ne prend le relais qu'après
      // la fin de l'animation (1s minimum au premier fix).
      if (elapsed < Math.max(durationRef.current, 1000)) return;
      if (elapsed > maxDrMs) return; // Stop predicting beyond limit

      const state = lastStateRef.current;
      if (!state || state.speed <= 0) return;

      const predicted = predictPosition(
        { ...state, timestamp: lastUpdateRef.current },
        Date.now(),
      );

      marker.setLatLng([predicted.lat, predicted.lng]);
      // Le point prédit devient la base de la prochaine animation : continuité
      // visuelle entre dead reckoning et interpolation (pas de saut en arrière).
      fromRef.current = { lat: predicted.lat, lng: predicted.lng };
    }, 200);

    return () => clearInterval(interval);
  }, [vehicle.speed]);

  const popupContent = useMemo(() => {
    const container = document.createElement('div');
    container.style.minWidth = '220px';

    const nameRow = document.createElement('div');
    nameRow.style.fontSize = '0.85rem';
    nameRow.style.fontWeight = '600';
    nameRow.style.marginBottom = '4px';
    nameRow.textContent = vehicle.name;
    container.appendChild(nameRow);

    const coords = document.createElement('div');
    coords.style.fontSize = '0.65rem';
    coords.style.fontFamily = 'var(--font-mono, monospace)';
    coords.style.color = 'var(--color-text-tertiary, #7A8BA3)';
    coords.style.marginBottom = '6px';
    coords.textContent = `${(vehicle.lat ?? 0).toFixed(6)}, ${(vehicle.lng ?? 0).toFixed(6)}`;
    container.appendChild(coords);

    const detail = document.createElement('div');
    detail.style.display = 'flex';
    detail.style.flexDirection = 'column';
    detail.style.gap = '2px';
    detail.style.marginBottom = '6px';

    if (vehicle.speed != null) {
      const speedKmh = (vehicle.speed * 3.6).toFixed(1);
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.textContent = `Vitesse · ${speedKmh} km/h`;
      detail.appendChild(row);
    }

    if (vehicle.accuracy !== undefined) {
      const row = document.createElement('div');
      row.style.fontSize = '0.7rem';
      row.style.color = 'var(--color-text-tertiary, #7A8BA3)';
      row.textContent = `Précision · ±${Math.round(vehicle.accuracy)}m`;
      detail.appendChild(row);
    }

    if (vehicle.heading != null) {
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.textContent = `Cap · ${vehicle.heading.toFixed(0)}°`;
      detail.appendChild(row);
    }

    if (vehicle.routeDistance && vehicle.routeDistance > 0) {
      const row = document.createElement('div');
      row.style.fontSize = '0.75rem';
      row.style.color = 'var(--color-text-secondary, #9BA6B9)';
      row.textContent = `Distance · ${formatDistance(vehicle.routeDistance)}`;
      detail.appendChild(row);
    }

    if (vehicle.eta) {
      const row = document.createElement('div');
      row.style.fontSize = '0.7rem';
      row.style.color = 'var(--color-status-moving, #F2A93C)';
      row.style.fontFamily = 'var(--font-mono, monospace)';
      row.textContent = `ETA · ${vehicle.eta}`;
      detail.appendChild(row);
    }

    container.appendChild(detail);

    const timeRow = document.createElement('div');
    timeRow.style.fontSize = '0.7rem';
    timeRow.style.color = 'var(--color-text-tertiary, #7A8BA3)';
    timeRow.style.marginBottom = '6px';
    const ts = new Date(vehicle.timestamp);
    timeRow.textContent = `Dernière position · ${formatDate(ts)} ${formatTime(ts)}`;
    container.appendChild(timeRow);

    if (vehicle.suspect) {
      const suspectBadge = document.createElement('div');
      suspectBadge.style.display = 'inline-block';
      suspectBadge.style.padding = '2px 10px';
      suspectBadge.style.borderRadius = '12px';
      suspectBadge.style.fontSize = '0.65rem';
      suspectBadge.style.fontWeight = '700';
      suspectBadge.style.textTransform = 'uppercase';
      suspectBadge.style.letterSpacing = '0.04em';
      suspectBadge.style.background = 'var(--color-red-muted, rgba(232,84,76,0.15))';
      suspectBadge.style.color = 'var(--color-red, #E8544C)';
      suspectBadge.style.border = '1px solid var(--color-red-muted, rgba(232,84,76,0.15))';
      suspectBadge.style.marginBottom = '4px';
      suspectBadge.textContent = 'SIGNAL GPS INSTABLE';
      container.appendChild(suspectBadge);
    }

    const badge = document.createElement('div');
    badge.style.display = 'inline-block';
    badge.style.padding = '2px 10px';
    badge.style.borderRadius = '12px';
    badge.style.fontSize = '0.65rem';
    badge.style.fontWeight = '700';
    badge.style.textTransform = 'uppercase';
    badge.style.letterSpacing = '0.04em';
    if (vehicle.suspect) {
      badge.style.background = 'var(--color-purple-muted, rgba(139,92,246,0.15))';
      badge.style.color = 'var(--color-purple, #8b5cf6)';
      badge.style.border = '1px solid var(--color-purple-muted, rgba(139,92,246,0.15))';
      badge.textContent = vehicle.status === 'moving' ? 'DÉPLACEMENT (NON CONFIRMÉ)' : 'ARRÊT (NON CONFIRMÉ)';
    } else if (vehicle.status === 'moving') {
      badge.style.background = 'var(--color-accent-muted, rgba(242,169,60,0.15))';
      badge.style.color = 'var(--color-status-moving, #F2A93C)';
      badge.style.border = '1px solid var(--color-accent-muted, rgba(242,169,60,0.15))';
      badge.textContent = 'EN MOUVEMENT';
    } else {
      badge.style.background = 'var(--color-teal-muted, rgba(63,167,150,0.15))';
      badge.style.color = 'var(--color-status-static, #3FA796)';
      badge.style.border = '1px solid var(--color-teal-muted, rgba(63,167,150,0.15))';
      badge.textContent = 'À L\'ARRÊT';
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

function FollowVehicleController({ vehicle, following, onUserInteraction }: {
  vehicle: VehicleData | null;
  following: boolean;
  onUserInteraction: () => void;
}) {
  const map = useMap();
  const prevPosRef = useRef<FollowReference | null>(null);
  const suppressUntilRef = useRef(0);

  useEffect(() => {
    if (!vehicle || !following) {
      prevPosRef.current = null;
      return;
    }
    const prev = prevPosRef.current;
    const recenter = shouldFollowRecenter(prev, vehicle);
    prevPosRef.current = { id: vehicle.id, lat: vehicle.lat, lng: vehicle.lng };
    if (!recenter) return;

    // Nos propres animations programmatiques (flyTo/panTo) déclenchent des
    // événements internes de déplacement : on les ignore via ce garde temporel
    // pour ne pas les confondre avec une interaction utilisateur réelle (drag
    // ou zoom) qui doit, elle, désactiver le mode suivi.
    suppressUntilRef.current = Date.now() + 500;
    if (!prev || prev.id !== vehicle.id) {
      // Première position du véhicule sélectionné : flyTo zoom 16 (comme
      // l'ancien MapFlyToDriver), puis suivi continu (panTo) ensuite.
      map.flyTo([vehicle.lat, vehicle.lng], 16, { duration: 0.8 });
    } else {
      // Suivi CONTINU : panTo fluide (0.5s) à CHAQUE nouvelle position reçue
      // pour ce véhicule — synchronisé avec l'animation du marqueur
      // (AnimatedMarker), là où l'ancien code ne recentrait qu'une seule fois.
      map.panTo([vehicle.lat, vehicle.lng], { animate: true, duration: 0.5 });
    }
  }, [vehicle, following, map]);

  useEffect(() => {
    if (!following) return;
    // Interaction manuelle (drag ou zoom utilisateur) → désactive le mode suivi
    // (l'utilisateur veut explorer la carte librement) ; un bouton "Suivre"
    // (fiche véhicule ou bouton flottant) permet de le réactiver.
    const onUserGesture = () => {
      if (Date.now() < suppressUntilRef.current) return;
      onUserInteraction();
    };
    map.on('dragstart', onUserGesture);
    map.on('zoomstart', onUserGesture);
    return () => {
      map.off('dragstart', onUserGesture);
      map.off('zoomstart', onUserGesture);
    };
  }, [following, map, onUserInteraction]);

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
  const lastPopupFocus = useRef<string | null>(null);

  // Recentrage ponctuel fourni par la recherche globale (MapPage) : réservé aux
  // résultats SANS véhicule temps réel (ex. une livraison). Pour un véhicule,
  // le suivi CONTINU est piloté par FollowVehicleController via selectedDriverId
  // (état unifié) — pas de double animation sur le même focus.
  useEffect(() => {
    if (!focusCenter) return;
    if (focusId && vehicles.some((v) => v.id === focusId)) return;
    map.flyTo([focusCenter.lat, focusCenter.lng], 15, { duration: 0.8 });
  }, [focusCenter, focusId, vehicles, map]);

  // Ouvre le popup du marqueur UNE fois par véhicule sélectionné via la
  // recherche globale. Le garde `lastPopupFocus` ne bloque PLUS le recentrage :
  // il ne sert qu'à ne pas rouvrir le popup en boucle — la caméra, elle, suit
  // le véhicule à chaque position tant que focusId reste défini (suivi continu
  // dans FollowVehicleController).
  useEffect(() => {
    if (!focusId || focusId === lastPopupFocus.current) return;
    lastPopupFocus.current = focusId;
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
  /** Synchronise la sélection (recherche globale MapPage) avec la sélection interne : les deux mécanismes pilotent le MÊME état de suivi. */
  onFocusChange?: (id: string | null) => void;
}

export default function RealTimeMap({ deliveryId, readOnly, initialPositions, deliveryLat, deliveryLng, focusId, focusCenter, onVehiclesUpdate, onFocusChange }: RealTimeMapProps) {
  const [vehicles, setVehicles] = useState<Map<string, VehicleData>>(new Map());
  const [routePath, setRoutePath] = useState<[number, number][]>([]);
  const [routingPolyline, setRoutingPolyline] = useState<[number, number][]>([]);
  const [routingETA, setRoutingETA] = useState<string | null>(null);
  const [routingDistance, setRoutingDistance] = useState<number>(0);
  const [routingLoading, setRoutingLoading] = useState(false);
  const [driverFilter, setDriverFilter] = useState('');
  // Snapshot corrigé : on ne stocke PLUS un objet VehicleData figé au clic (la
  // fiche et la caméra ne suivaient plus jamais les positions suivantes).
  // selectedDriverId reste le SEUL état de sélection ; la donnée affichée est
  // DÉRIVÉE en direct du flux temps réel (Map `vehicles`) à chaque render.
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  // Mode "Suivre" : tant qu'un véhicule est sélectionné, la caméra recentre à
  // CHAQUE nouvelle position reçue (FollowVehicleController). Désactivé dès
  // que l'utilisateur déplace/zoome la carte manuellement (drag/zoom) —
  // réactivable via le bouton "Suivre" de la fiche véhicule ou le bouton
  // flottant "Recentrer".
  const [following, setFollowing] = useState(true);
  // Horloge basse fréquence : fait réagir le bandeau "Position non actualisée
  // depuis 2 min" en temps réel, même quand le véhicule s'arrête (plus aucun
  // update WebSocket → le render seul ne suffirait pas à faire apparaître /
  // disparaître le bandeau automatiquement).
  const [now, setNow] = useState(() => Date.now());
  const devPerf = useDevicePerformance();

  const { data: driversData } = useQuery({
    queryKey: ['drivers', 'list'],
    queryFn: () => api.get('/drivers?limit=100').then((r: { data: unknown }) =>
      ((r.data as { data?: { id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { id: string; licensePlate: string } }[] })?.data ?? r.data ?? []) as { id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { id: string; licensePlate: string } }[]
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

  const allDrivers: Array<{ id: string; firstName: string; lastName: string; licenseNumber: string; vehicle?: { id: string; licensePlate: string } }> = driversData ?? [];

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

  // Dérivation en direct du flux temps réel : tant que le véhicule est
  // sélectionné, la fiche (vitesse, statut, dernière position, ETA…) ET les
  // coordonnées passées au suivi caméra restent synchronisées avec chaque
  // positionUpdate WebSocket — fin du snapshot figé au clic de sélection.
  const selectedDriver = useMemo(
    () => (selectedDriverId ? allPositions.find((v) => v.id === selectedDriverId) ?? null : null),
    [allPositions, selectedDriverId],
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // UNIFICATION des deux mécanismes de sélection (recherche globale MapPage via
  // focusId/focusCenter, recherche interne via driverFilter) : les deux pilotent
  // le MÊME état de suivi (selectedDriverId + following). focusId reste défini
  // tant que l'utilisateur ne change pas de sélection (la purge automatique à
  // 3 s a été retirée côté MapPage) : le suivi continu fonctionne donc aussi
  // après une recherche globale.
  const lastFocusRef = useRef<string | null>(null);
  useEffect(() => {
    if (focusId === lastFocusRef.current) return;
    if (!focusId) {
      lastFocusRef.current = null;
      setSelectedDriverId(null);
      return;
    }
    lastFocusRef.current = focusId;
    setSelectedDriverId(focusId);
    setFollowing(true);
  }, [focusId]);
  const searchResults = useMemo(() => {
    if (!driverFilter.trim()) return [];
    const q = driverFilter.toLowerCase();
    const active = allPositions.filter((v) => v.name.toLowerCase().includes(q));
    // P1 : la Map des positions est cléée par vehicleId, pas driverId — comparer des
    // driverId (d.id) contre des vehicleId (v.id) était TOUJOURS vrai → chaque chauffeur
    // en ligne apparaissait aussi « Hors ligne ». On compare par le véhicule assigné.
    const activeVehicleIds = new Set(active.map((v) => v.vehicleId));
    const offline = allDrivers
      .filter(
        (d) =>
          !activeVehicleIds.has(d.vehicle?.id || '') &&
          `${d.firstName} ${d.lastName}`.toLowerCase().includes(q),
      )
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
    setVehicles((prev) => mergeBootstrapPositions(prev, livePositions, computeETAForVehicle));
  }, [livePositions, computeETAForVehicle]);

  const addPosition = useCallback((update: PositionUpdate) => {
    const dLat = deliveryLatRef.current;
    const dLng = deliveryLngRef.current;

    setVehicles((prev) => mergePositionUpdate(prev, update, computeETAForVehicle));

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

    // P2 : à chaque reconnexion (ex. refresh token toutes les ~14 min), le serveur ne
    // re-joint que company:* et driver:* dans handleConnection — la room delivery:*
    // était perdue. On resubscribe à chaque 'connect'.
    const resubscribe = () => {
      if (deliveryId) socket.emit('subscribeToDelivery', deliveryId);
      else socket.emit('subscribeToCompany');
    };
    socket.on('connect', resubscribe);

    socket.on('positionUpdate', addPosition);
    socket.on('batchPositionUpdate', (updates: PositionUpdate[]) => {
      updates.forEach((u) => addPosition(u));
    });

    return () => {
      socket.off('connect', resubscribe);
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
      maxZoom={20}
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
              onClick={() => {
                setDriverFilter('');
                setSelectedDriverId(null);
                setFollowing(true);
                onFocusChange?.(null);
              }}
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
                      // Sélection : on ne stocke que l'ID (plus de snapshot
                      // figé), on active le suivi continu, et on synchronise la
                      // recherche globale (MapPage) avec la même sélection.
                      setSelectedDriverId(v.id);
                      setFollowing(true);
                      onFocusChange?.(v.id);
                    }
                    setDriverFilter('');
                  }}
                  className={`${styles.searchResultItem}${v.isOffline ? ` ${styles.searchResultItemOffline}` : ''}`}
                >
                  <span
                    className={styles.searchResultIcon}
                    style={{ color: v.isOffline ? 'var(--color-text-tertiary)' : 'var(--color-accent)' }}
                  >
                    {v.isOffline ? '—' : '•'}
                  </span>
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
          <FollowVehicleController
            vehicle={selectedDriver}
            following={following}
            onUserInteraction={() => setFollowing(false)}
          />
          <button
            onClick={() => setFollowing((f) => !f)}
            className={`${styles.followFloating}${following ? ` ${styles.followFloatingActive}` : ''}`}
            style={{ position: 'absolute', bottom: 20, left: 10, zIndex: 1000 }}
            aria-pressed={following}
          >
            {following ? '🎯 Suivi actif' : '🎯 Suivre'}
          </button>
          <div style={{
            position: 'absolute', bottom: 20, right: 10, zIndex: 1000,
          }} className={styles.driverCard}>
            <div className={styles.driverCardHeader}>
              <div className={styles.driverCardTitle}>{selectedDriver.name}</div>
              <div className={styles.driverCardActions}>
                <button
                  onClick={() => setFollowing((f) => !f)}
                  className={`${styles.followToggle}${following ? ` ${styles.followToggleActive}` : ''}`}
                  aria-pressed={following}
                >
                  {following ? '🎯 Suivi actif' : '🎯 Suivre'}
                </button>
                <button
                  onClick={() => {
                    setSelectedDriverId(null);
                    setFollowing(true);
                    onFocusChange?.(null);
                  }}
                  className={styles.driverCardClose}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className={styles.driverCardBody}>
              <DetailRow label="Statut" value={selectedDriver.status === 'moving' ? 'En mouvement' : 'À l\'arrêt'} color={selectedDriver.status === 'moving' ? 'var(--color-accent)' : 'var(--color-teal)'} />
              {selectedDriver.speed != null && (
                <DetailRow label="Vitesse" value={`${(selectedDriver.speed * 3.6).toFixed(1)} km/h`} />
              )}
              {selectedDriver.heading != null && (
                <DetailRow label="Direction" value={`${selectedDriver.heading.toFixed(0)}°`} />
              )}
              <DetailRow label="Position" value={`${(selectedDriver.lat ?? 0).toFixed(5)}, ${(selectedDriver.lng ?? 0).toFixed(5)}`} mono />
              {selectedDriver.accuracy != null && (
                <DetailRow label="Précision GPS" value={`±${Math.round(selectedDriver.accuracy)}m`} />
              )}
              {selectedDriver.confidence != null && (
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

            {/* Bandeau réactif EN TEMPS RÉEL : selectedDriver est dérivé en
                direct du flux (pas de snapshot figé), et une horloge basse
                fréquence (`now`) déclenche le render même quand le véhicule
                s'arrête — le bandeau apparaît/disparaît tout seul, sans
                re-sélectionner le véhicule. */}
            {(!selectedDriver.timestamp || now - new Date(selectedDriver.timestamp).getTime() > 120_000) && (
              <div className={styles.warningBanner}>
                Position non actualisée depuis plus de 2 minutes
              </div>
            )}
          </div>
        </>
      )}

      {routePath.length > 1 && (
        <Polyline
          positions={routePath}
          color={themeColor('--color-accent', '#F2A93C')}
          weight={3}
          opacity={0.5}
          dashArray="8 4"
          // Points GPS denses : simplification douce pour garder le tracé fidèle
          // à la route au zoom serré (pas d'escalier), sans coût de rendu.
          smoothFactor={0.5}
        />
      )}

      {routingPolyline.length > 1 && (
        <Polyline
          positions={routingPolyline}
          color={themeColor('--color-teal', '#3FA796')}
          weight={4}
          opacity={0.8}
          // Itinéraire long (des centaines de points OSRM) : on garde la
          // simplification par défaut pour rester fluide pendant le déplacement.
          smoothFactor={1}
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
            ETA · {routingETA}
          </span>
          <span className={styles.etaDistance}>
            {formatDistance(routingDistance)}
          </span>
          {routingLoading && (
            <span className={styles.etaLoading} aria-hidden="true" />
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