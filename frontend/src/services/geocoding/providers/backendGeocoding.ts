import type { GeocodingProvider, GeocodingResult, PlacePrediction } from '../types'
import { getApiBaseUrl } from '../../api/config'

const sessionCache = new Map<string, GeocodingResult[]>()

// Base API résolue une seule fois (override localStorage / VITE_API_URL).
const BASE = getApiBaseUrl()

export class BackendGeocodingProvider implements GeocodingProvider {
  private abortController: AbortController | null = null

  async search(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return []

    const key = query.toLowerCase().trim()
    const cached = sessionCache.get(key)
    if (cached) return cached

    this.abortController?.abort()
    this.abortController = new AbortController()

    try {
      const [nominatimRes, placesRes] = await Promise.all([
        fetch(`${BASE}/geocoding/search?q=${encodeURIComponent(query)}`, { signal: this.abortController.signal })
          .then(r => r.ok ? r.json() as Promise<GeocodingResult[]> : Promise.resolve([]))
          .catch(() => [] as GeocodingResult[]),
        fetch(`${BASE}/geocoding/places/autocomplete?input=${encodeURIComponent(query)}`, { signal: this.abortController.signal })
          .then(r => r.ok ? r.json() as Promise<PlacePrediction[]> : Promise.resolve([]))
          .catch(() => [] as PlacePrediction[]),
      ])

      const placesMapped: GeocodingResult[] = placesRes.map(p => ({
        lat: 0, lng: 0,
        label: p.mainText || p.description.split(',')[0],
        displayName: p.description,
        placeId: p.placeId,
        pendingDetails: true,
      }))

      const seen = new Set<string>()
      const merged: GeocodingResult[] = []
      for (const r of [...placesMapped, ...nominatimRes]) {
        const k = r.placeId || `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`
        if (!seen.has(k)) { seen.add(k); merged.push(r) }
      }
      if (merged.length > 0) sessionCache.set(key, merged)
      return merged.slice(0, 15)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return []
      return []
    }
  }

  async fetchPlaceDetails(placeId: string): Promise<GeocodingResult | null> {
    try {
      const res = await fetch(`${BASE}/geocoding/places/details?placeid=${placeId}`)
      if (!res.ok) return null
      const data = await res.json()
      if (!data?.lat) return null
      return { lat: data.lat, lng: data.lng, label: data.name, displayName: data.address, placeId }
    } catch { return null }
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`
    const cached = sessionCache.get(key) as unknown as string
    if (cached) return cached
    try {
      const res = await fetch(`${BASE}/geocoding/reverse?lat=${lat}&lng=${lng}`)
      if (!res.ok) return null
      const data = await res.json()
      const label = data.label || null
      if (label) sessionCache.set(key, label as unknown as GeocodingResult[])
      return label
    } catch { return null }
  }
}
