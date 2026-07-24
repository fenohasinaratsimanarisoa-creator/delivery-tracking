import type { GeocodingProvider, GeocodingResult } from '../types'

const BASE = 'https://nominatim.openstreetmap.org'
const USER_AGENT = 'DeliveryTrack/1.0 (logistics)'

const MG_VIEWBOX = '43,11,51,-26'
const MG_BOUNDED = 1

function extractLocalLabel(item: any): string {
  const addr = item.address || {}
  const name = item.name || ''
  const road = addr.road || addr.street || ''
  const suburb = addr.suburb || addr.neighbourhood || addr.quarter || addr.hamlet || ''
  const city = addr.city || addr.town || addr.village || addr.county || ''
  const district = addr.state_district || addr.region || ''
  const fallback = item.display_name?.split(',')[0] || ''

  const parts = [name || road || fallback, suburb, city || district].filter(Boolean)
  const seen = new Set<string>()
  return parts.filter((p) => {
    const lower = p.toLowerCase().trim()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  }).slice(0, 3).join(' — ')
}

export class NominatimProvider implements GeocodingProvider {
  async search(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return []

    const params = new URLSearchParams({
      q: query,
      format: 'json',
      limit: '8',
      'accept-language': 'fr',
      countrycodes: 'mg',
      viewbox: MG_VIEWBOX,
      bounded: String(MG_BOUNDED),
      addressdetails: '1',
    })

    const url = `${BASE}/search?${params}`

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return []

    const data: any[] = await res.json()
    return data.map((item) => ({
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      label: extractLocalLabel(item),
      displayName: item.display_name,
    }))
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const url = `${BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr&addressdetails=1`

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null

    const data: any = await res.json()
    return data?.display_name || null
  }
}
