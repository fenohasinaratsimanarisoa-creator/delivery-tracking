/**
 * Service de géocodage — fournisseur remplaçable.
 *
 * Fournisseur actif : Google Maps Places API (si VITE_GOOGLE_MAPS_API_KEY défini),
 * sinon Nominatim/OpenStreetMap (fallback gratuit).
 *
 * Google Maps : meilleure couverture adresses exactes, payant (~2.83 $/1000 requêtes).
 * Le debounce à 350ms et le cache limitent les appels.
 * Pour basculer : définir VITE_GOOGLE_MAPS_API_KEY dans .env ou appeler setGeocodingProvider().
 */

import { GoogleMapsProvider } from './providers/googleMaps'
import { BackendGeocodingProvider } from './providers/backendGeocoding'
import type { GeocodingProvider, GeocodingResult } from './types'

function detectProvider(): GeocodingProvider {
  const googleKey = typeof import.meta !== 'undefined' ? import.meta.env.VITE_GOOGLE_MAPS_API_KEY : undefined
  if (googleKey) {
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
