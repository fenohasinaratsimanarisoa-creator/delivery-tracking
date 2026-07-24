export interface GeocodingResult {
  lat: number
  lng: number
  label: string
  displayName: string
  placeId?: string
  pendingDetails?: boolean
}

export interface PlacePrediction {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

export interface GeocodingProvider {
  search(query: string): Promise<GeocodingResult[]>
  reverse(lat: number, lng: number): Promise<string | null>
}
