import { useState, useRef, useCallback } from 'react';
import { getApiBaseUrl } from '../services/api/config';
import type { GeocodingResult } from '../services/geocoding/types';

const MG_CENTER = { lat: -18.7669, lng: 46.8691 };
const GPS_CACHE_KEY = 'dt_last_gps';
const GPS_CACHE_TTL = 5 * 60 * 1000; // 5 min

interface GpsCache {
  lat: number;
  lng: number;
  ts: number;
}

function getCachedPosition(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(GPS_CACHE_KEY);
    if (!raw) return null;
    const cached: GpsCache = JSON.parse(raw);
    if (Date.now() - cached.ts < GPS_CACHE_TTL) {
      return { lat: cached.lat, lng: cached.lng };
    }
  } catch {}
  return null;
}

function setCachedPosition(lat: number, lng: number) {
  try {
    localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({ lat, lng, ts: Date.now() }));
  } catch {}
}

const sessionNearby = new Map<string, GeocodingResult[]>();

export interface GpsPreloadResult {
  nearbyPlaces: GeocodingResult[];
  isLoading: boolean;
  position: { lat: number; lng: number } | null;
  preload: () => void;
}

export function useGpsPreload(): GpsPreloadResult {
  const [nearbyPlaces, setNearbyPlaces] = useState<GeocodingResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const loadedRef = useRef(false);
  const fetchRef = useRef(false);

  const fetchNearby = useCallback(async (lat: number, lng: number) => {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = sessionNearby.get(key);
    if (cached) {
      setNearbyPlaces(cached);
      return;
    }

    try {
      const res = await fetch(`${getApiBaseUrl()}/geocoding/nearby?lat=${lat}&lng=${lng}`);
      if (!res.ok) return;
      const data: GeocodingResult[] = await res.json();
      if (data.length > 0) {
        sessionNearby.set(key, data);
        setNearbyPlaces(data);
      }
    } catch {}
  }, []);

  const preload = useCallback(() => {
    if (fetchRef.current) return;
    fetchRef.current = true;

    if (loadedRef.current) return;
    loadedRef.current = true;

    const cached = getCachedPosition();
    if (cached) {
      setPosition(cached);
      fetchNearby(cached.lat, cached.lng);
      return;
    }

    setIsLoading(true);
    if (!navigator.geolocation) {
      setPosition(MG_CENTER);
      fetchNearby(MG_CENTER.lat, MG_CENTER.lng);
      setIsLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      setPosition(MG_CENTER);
      fetchNearby(MG_CENTER.lat, MG_CENTER.lng);
      setIsLoading(false);
    }, 2000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timeout);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCachedPosition(lat, lng);
        setPosition({ lat, lng });
        fetchNearby(lat, lng);
        setIsLoading(false);
      },
      () => {
        clearTimeout(timeout);
        setPosition(MG_CENTER);
        fetchNearby(MG_CENTER.lat, MG_CENTER.lng);
        setIsLoading(false);
      },
      { enableHighAccuracy: false, timeout: 2000, maximumAge: 300000 },
    );
  }, [fetchNearby]);

  return { nearbyPlaces, isLoading, position, preload };
}
