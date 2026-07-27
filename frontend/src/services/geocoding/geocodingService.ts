/**
 * Service de géocodage — fournisseur remplaçable.
 *
 * Fournisseur par défaut : BackendGeocodingProvider (appels API via backend avec cache Redis + Nominatim).
 * Google Maps Places API est un fallback OPTIONNEL, désactivé par défaut.
 *
 * ⚠️ SÉCURITÉ : Le provider Google Maps appelle l'API Google directement depuis le navigateur
 * avec la clé embarquée dans le bundle JS. Quiconque inspecte le réseau peut voler cette clé.
 * → Ne PAS activer VITE_GOOGLE_MAPS_ENABLED=true sans avoir configuré des restrictions HTTP Referrer
 *   ET un budget d'alerte sur Google Cloud Console.
 * → Voir : https://developers.google.com/maps/api-security-best-practices
 *
 * Pour activer Google Maps (⚠️ risque sécurité) :
 *   1. Définir VITE_GOOGLE_MAPS_API_KEY dans .env
 *   2. Définir VITE_GOOGLE_MAPS_ENABLED=true dans .env
 *   3. Configurer les restrictions HTTP Referrer dans Google Cloud Console
 *   4. Configurer une alerte de budget dans Google Cloud Console
 */

import { GoogleMapsProvider } from './providers/googleMaps'
import { BackendGeocodingProvider } from './providers/backendGeocoding'
import type { GeocodingProvider, GeocodingResult } from './types'

function detectProvider(): GeocodingProvider {
  const googleKey = typeof import.meta !== 'undefined' ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY : undefined
  const googleEnabled = typeof import.meta !== 'undefined' ? import.meta.env.VITE_GOOGLE_MAPS_ENABLED === 'true' : false
  if (googleKey && googleEnabled) {
    return new GoogleMapsProvider(googleKey)
  }
  return new BackendGeocodingProvider()
}

let provider: GeocodingProvider = detectProvider()

export function setGeocodingProvider(p: GeocodingProvider) {
  provider = p
}

export async function searchLocation(query: string): Promise<GeocodingResult[]> {
  return provider.search(query)
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  return provider.reverse(lat, lng)
}
