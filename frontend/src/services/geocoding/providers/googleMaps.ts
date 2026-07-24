import type { GeocodingProvider, GeocodingResult } from '../types'

const AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json'
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json'
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json'

export class GoogleMapsProvider implements GeocodingProvider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async search(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return []

    const autocompleteUrl = `${AUTOCOMPLETE_URL}?input=${encodeURIComponent(query)}&types=geocode&language=fr&components=country:mg&key=${this.apiKey}`
    const autocompleteRes = await fetch(autocompleteUrl, { signal: AbortSignal.timeout(5000) })
    if (!autocompleteRes.ok) return []
    const autocompleteData: any = await autocompleteRes.json()
    if (autocompleteData.status !== 'OK' || !autocompleteData.predictions) return []

    const predictions = autocompleteData.predictions.slice(0, 5)
    const results: GeocodingResult[] = []

    for (const p of predictions) {
      const detailsUrl = `${DETAILS_URL}?place_id=${p.place_id}&fields=geometry,formatted_address,name&key=${this.apiKey}`
      try {
        const detailsRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(5000) })
        if (!detailsRes.ok) continue
        const detailsData: any = await detailsRes.json()
        if (detailsData.status !== 'OK' || !detailsData.result) continue
        const loc = detailsData.result.geometry.location
        results.push({
          lat: loc.lat,
          lng: loc.lng,
          label: detailsData.result.name || p.description,
          displayName: detailsData.result.formatted_address || p.description,
        })
      } catch {
        continue
      }
    }

    return results
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const url = `${GEOCODE_URL}?latlng=${lat},${lng}&language=fr&key=${this.apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data: any = await res.json()
    if (data.status !== 'OK' || !data.results?.length) return null
    return data.results[0].formatted_address
  }
}
