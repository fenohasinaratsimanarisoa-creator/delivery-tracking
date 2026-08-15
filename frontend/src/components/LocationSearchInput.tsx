import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, MapPin, Search, Crosshair, ArrowRightFromLine } from 'lucide-react'
import { reverseGeocode } from '../services/geocoding/geocodingService'
import { useGpsPreload } from '../hooks/useGpsPreload'
import { getApiBaseUrl } from '../services/api/config'
import type { GeocodingResult } from '../services/geocoding/types'
import { MG_COMMUNES } from '../services/geocoding/mg-communes'
import { TILE_PROVIDERS } from '../features/map/tileProviders'
import { enableRetinaDefaultMarker } from '../features/map/markerIcons'
import styles from './LocationSearchInput.module.css'

// Marqueur draggable en version @2x sur écrans HiDPI (Retina/4K).
enableRetinaDefaultMarker()

const localDb: GeocodingResult[] = MG_COMMUNES.map(([name, lat, lng]) => ({
  lat: lat as number, lng: lng as number,
  label: name as string, displayName: `${name}, Madagasikara`,
}))

export interface LocationValue { lat: number | null; lng: number | null; label: string }
interface RecentPlace { label: string; lat: number; lng: number }
interface LocationSearchInputProps {
  placeholder?: string; value: LocationValue; onChange: (v: LocationValue) => void
  onBlur?: () => void; error?: string | null; recentPlaces?: RecentPlace[]
  showCopyButton?: boolean; onCopyFromOther?: () => void; copyTooltip?: string
  distanceFrom?: { lat: number; lng: number }
}

function fuzzyMatch(t: string, q: string) { return t.toLowerCase().includes(q.toLowerCase()) }
function dedupeByCoord(items: GeocodingResult[]) {
  const s = new Set<string>()
  return items.filter(r => { const k = r.placeId || `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`; if (s.has(k)) return false; s.add(k); return true })
}

function DraggableMarker({ position, onChange }: { position: [number, number]; onChange: (lat: number, lng: number) => void }) {
  const mRef = useRef<L.Marker>(null)
  useMapEvents({ click(e) { onChange(e.latlng.lat, e.latlng.lng) } })
  return <Marker ref={mRef} position={position} draggable eventHandlers={{ dragend: () => { const m = mRef.current; if (m) { const p = m.getLatLng(); onChange(p.lat, p.lng) } } }} />
}
function MapUpdater({ center }: { center: [number, number] }) { const map = useMap(); useEffect(() => { map.setView(center, map.getZoom()) }, [center, map]); return null }

async function fetchGooglePlaces(input: string): Promise<GeocodingResult[]> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/geocoding/places/autocomplete?input=${encodeURIComponent(input)}`)
    if (!r.ok) return []
    const predictions: { placeId: string; description: string; mainText: string }[] = await r.json()
    return predictions.map(p => ({ lat: 0, lng: 0, label: p.mainText, displayName: p.description, placeId: p.placeId, pendingDetails: true }))
  } catch { return [] }
}

async function fetchNominatim(input: string): Promise<GeocodingResult[]> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/geocoding/search?q=${encodeURIComponent(input)}`)
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

async function fetchPlaceDetails(placeId: string): Promise<GeocodingResult | null> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/geocoding/places/details?placeid=${placeId}`)
    if (!r.ok) return null
    const d = await r.json()
    if (!d?.lat) return null
    return { lat: d.lat, lng: d.lng, label: d.name, displayName: d.address, placeId }
  } catch { return null }
}

export default memo(function LocationSearchInput({
  placeholder, value, onChange, onBlur, error,
  recentPlaces, showCopyButton, onCopyFromOther, copyTooltip, distanceFrom,
}: LocationSearchInputProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t('locationSearch.placeholder');
  const [inputValue, setInputValue] = useState(value.label || '')
  const [results, setResults] = useState<GeocodingResult[]>([])
  const [netLoading, setNetLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const [showMap, setShowMap] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const pendingRef = useRef('')
  const gpsPreloaded = useRef(false)
  const { nearbyPlaces, preload } = useGpsPreload()

  useEffect(() => { if (value.label && !inputValue) setInputValue(value.label) }, [value.label])

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setInputValue(q)
    clearTimeout(debounceRef.current)
    if (!q.trim()) { onChange({ lat: null, lng: null, label: '' }); setResults([]); setOpen(!!(recentPlaces && recentPlaces.length > 0)); return }
    const locals = [...localDb, ...nearbyPlaces, ...(recentPlaces?.map(p => ({ lat: p.lat, lng: p.lng, label: p.label, displayName: p.label })) || [])].filter(r => fuzzyMatch(r.label, q) || fuzzyMatch(r.displayName, q))
    if (locals.length > 0) setOpen(true)
    if (q.trim().length >= 2) {
      debounceRef.current = setTimeout(async () => {
        pendingRef.current = q
        setNetLoading(true)
        try {
          const [google, nominatim] = await Promise.all([fetchGooglePlaces(q), fetchNominatim(q)])
          if (pendingRef.current !== q) return
          const merged = dedupeByCoord([...google, ...nominatim])
          setResults(merged)
          if (merged.length > 0) setOpen(true)
        } finally {
          if (pendingRef.current === q) setNetLoading(false)
        }
      }, 150)
    }
  }, [onChange, nearbyPlaces, recentPlaces])

  const selectResult = useCallback(async (r: GeocodingResult) => {
    if (r.placeId && (!r.lat || r.lat === 0)) {
      const details = await fetchPlaceDetails(r.placeId)
      if (details) { setInputValue(details.displayName); onChange({ lat: details.lat, lng: details.lng, label: details.displayName }) }
      else { setInputValue(r.displayName); onChange({ lat: r.lat, lng: r.lng, label: r.displayName }) }
    } else {
      setInputValue(r.displayName || r.label); onChange({ lat: r.lat, lng: r.lng, label: r.displayName || r.label })
    }
    setOpen(false); setResults([])
  }, [onChange])

  const allResults = useMemo(() => {
    const locals = inputValue.trim() ? dedupeByCoord([...localDb, ...nearbyPlaces, ...(recentPlaces?.map(p => ({ lat: p.lat, lng: p.lng, label: p.label, displayName: p.label })) || [])].filter(r => fuzzyMatch(r.label, inputValue) || fuzzyMatch(r.displayName, inputValue))).slice(0, 15) : []
    const net = results.filter(r => !locals.some(l => (l.placeId && l.placeId === r.placeId) || (l.lat === r.lat && l.lng === r.lng)))
    return [...locals, ...net]
  }, [inputValue, nearbyPlaces, recentPlaces, results])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open || allResults.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx(p => p < allResults.length - 1 ? p + 1 : 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx(p => p > 0 ? p - 1 : allResults.length - 1) }
    else if (e.key === 'Enter' && selectedIdx >= 0) { e.preventDefault(); selectResult(allResults[selectedIdx]) }
    else if (e.key === 'Escape') setOpen(false)
  }, [open, allResults, selectedIdx, selectResult])

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && inputRef.current && !inputRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn); return () => document.removeEventListener('mousedown', fn)
  }, [])
  useEffect(() => { return () => clearTimeout(debounceRef.current) }, [])

  const handleMapConfirm = useCallback((lat: number, lng: number) => {
    reverseGeocode(lat, lng).then(label => { onChange({ lat, lng, label: label || `${lat.toFixed(6)}, ${lng.toFixed(6)}` }); setInputValue(label || `${lat.toFixed(6)}, ${lng.toFixed(6)}`); setShowMap(false) })
  }, [onChange])

  const mapPos: [number, number] = value.lat != null && value.lng != null ? [value.lat, value.lng] : [-18.8792, 47.5079]
  const showDropdown = open && allResults.length > 0

  return (
    <div className={styles.wrapper}>
      <div className={styles.inputRow}>
        <div className={styles.inputWrap}>
          <Search size={14} className={styles.searchIcon} />
          <input ref={inputRef} type="text" placeholder={resolvedPlaceholder} className={`dialog-input ${styles.input}`} value={inputValue} onChange={onInputChange}
            onFocus={() => { if (!gpsPreloaded.current) { gpsPreloaded.current = true; preload() } }}
            onBlur={() => {
              if (inputValue.trim() && !value.label) {
                onChange({ lat: null, lng: null, label: inputValue.trim() });
              }
              onBlur?.();
            }} onKeyDown={handleKeyDown} autoComplete="off" />
          {netLoading && <Loader2 size={14} className={styles.loaderIcon} />}
        </div>
        {showCopyButton && <button type="button" onClick={onCopyFromOther} title={copyTooltip || t('locationSearch.copy')} className={styles.copyBtn}><ArrowRightFromLine size={14} /></button>}
        <button type="button" onClick={() => setShowMap(!showMap)} title={t('locationSearch.adjustOnMap')} className={styles.mapBtn}><Crosshair size={14} /></button>
      </div>
      {error && <div className={styles.errorText}>{error}</div>}
      {showDropdown && (
        <div ref={dropdownRef} className={styles.dropdown}>
          {allResults.map((r, i) => (
            <button key={r.placeId || `${r.lat}-${r.lng}-${i}`} type="button" onClick={() => selectResult(r)} onMouseEnter={() => setSelectedIdx(i)}
              className={`${styles.dropdownItem}${i === selectedIdx ? ` ${styles.dropdownItemActive}` : ''}${i < allResults.length - 1 ? ` ${styles.dropdownItemBorder}` : ''}`}>
              <MapPin size={14} className={styles.mapIcon} />
              <div className={styles.resultContent}><div className={styles.resultLabel}>{r.label}</div><div className={styles.resultSub}>{r.displayName}</div></div>
              {distanceFrom && <span className={styles.distanceBadge}>{haversineKm(distanceFrom.lat, distanceFrom.lng, r.lat, r.lng).toFixed(1)} km</span>}
            </button>
          ))}
        </div>
      )}
      {open && !netLoading && allResults.length === 0 && inputValue.trim().length >= 2 && (
        <div className={styles.noResults}>{t('locationSearch.noResults')}</div>
      )}
      {showMap && (
        <div className={styles.mapContainer}>
          <MapContainer center={mapPos} zoom={16} maxZoom={TILE_PROVIDERS.plan.maxZoom} style={{ height: '100%', width: '100%' }} zoomControl={true}>
            <TileLayer
              attribution={TILE_PROVIDERS.plan.attribution}
              url={TILE_PROVIDERS.plan.url}
              maxZoom={TILE_PROVIDERS.plan.maxZoom}
              detectRetina
            />
            <DraggableMarker position={mapPos} onChange={handleMapConfirm} /><MapUpdater center={mapPos} />
          </MapContainer>
          <div className={styles.mapHint}>{t('locationSearch.mapHint')}</div>
        </div>
      )}
    </div>
  )
})

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; const dLat = ((lat2 - lat1) * Math.PI) / 180; const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
