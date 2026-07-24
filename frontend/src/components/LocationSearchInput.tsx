import { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Loader2, MapPin, Search, Crosshair, ArrowRightFromLine } from 'lucide-react'
import { reverseGeocode } from '../services/geocoding/geocodingService'
import { useGpsPreload } from '../hooks/useGpsPreload'
import type { GeocodingResult } from '../services/geocoding/types'
import { MG_COMMUNES } from '../services/geocoding/mg-communes'

import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'
const DefaultIcon = L.icon({ iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41] })
L.Marker.prototype.options.icon = DefaultIcon

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
    const r = await fetch(`/api/geocoding/places/autocomplete?input=${encodeURIComponent(input)}`)
    if (!r.ok) return []
    const predictions: { placeId: string; description: string; mainText: string }[] = await r.json()
    return predictions.map(p => ({ lat: 0, lng: 0, label: p.mainText, displayName: p.description, placeId: p.placeId, pendingDetails: true }))
  } catch { return [] }
}

async function fetchNominatim(input: string): Promise<GeocodingResult[]> {
  try {
    const r = await fetch(`/api/geocoding/search?q=${encodeURIComponent(input)}`)
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

async function fetchPlaceDetails(placeId: string): Promise<GeocodingResult | null> {
  try {
    const r = await fetch(`/api/geocoding/places/details?placeid=${placeId}`)
    if (!r.ok) return null
    const d = await r.json()
    if (!d?.lat) return null
    return { lat: d.lat, lng: d.lng, label: d.name, displayName: d.address, placeId }
  } catch { return null }
}

export default memo(function LocationSearchInput({
  placeholder = 'Rechercher un lieu…', value, onChange, onBlur, error,
  recentPlaces, showCopyButton, onCopyFromOther, copyTooltip, distanceFrom,
}: LocationSearchInputProps) {
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
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', pointerEvents: 'none', zIndex: 1 }} />
          <input ref={inputRef} type="text" placeholder={placeholder} className="dialog-input" value={inputValue} onChange={onInputChange}
            onFocus={() => { if (!gpsPreloaded.current) { gpsPreloaded.current = true; preload() } }}
            onBlur={onBlur} onKeyDown={handleKeyDown} autoComplete="off" style={{ paddingLeft: 32, paddingRight: 32 }} />
          {netLoading && <Loader2 size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', animation: 'dt-spin 0.6s linear infinite' }} />}
        </div>
        {showCopyButton && <button type="button" onClick={onCopyFromOther} title={copyTooltip || 'Copier'} style={{ padding: 6, border: '1px solid var(--color-input-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-input-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', flexShrink: 0 }}><ArrowRightFromLine size={14} /></button>}
        <button type="button" onClick={() => setShowMap(!showMap)} title="Ajuster sur la carte" style={{ padding: 6, border: '1px solid var(--color-input-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-input-bg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-secondary)', flexShrink: 0 }}><Crosshair size={14} /></button>
      </div>
      {error && <div style={{ fontSize: '0.75rem', color: '#dc3545', marginTop: 4 }}>{error}</div>}
      {showDropdown && (
        <div ref={dropdownRef} style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', maxHeight: 320, overflow: 'auto' }}>
          {allResults.map((r, i) => (
            <button key={r.placeId || `${r.lat}-${r.lng}-${i}`} type="button" onClick={() => selectResult(r)} onMouseEnter={() => setSelectedIdx(i)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: i === selectedIdx ? 'var(--color-accent-muted)' : 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-text)', fontFamily: 'var(--font-body)', borderBottom: i < allResults.length - 1 ? '1px solid var(--color-border-subtle)' : 'none' }}>
              <MapPin size={14} style={{ marginTop: 2, flexShrink: 0, color: 'var(--color-accent)' }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.displayName}</div></div>
              {distanceFrom && <span style={{ fontSize: '0.6rem', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', padding: '2px 5px', borderRadius: 4, flexShrink: 0, marginTop: 2, background: 'var(--color-surface-alt, #182339)', color: 'var(--color-text-tertiary, #7A8BA3)' }}>{haversineKm(distanceFrom.lat, distanceFrom.lng, r.lat, r.lng).toFixed(1)} km</span>}
            </button>
          ))}
        </div>
      )}
      {open && !netLoading && allResults.length === 0 && inputValue.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999, marginTop: 4, padding: '12px 16px', background: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>Aucun résultat trouvé — précisez votre recherche ou utilisez la carte</div>
      )}
      {showMap && (
        <div style={{ marginTop: 8, height: 250, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border-subtle)' }}>
          <MapContainer center={mapPos} zoom={16} style={{ height: '100%', width: '100%' }} zoomControl={true}>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <DraggableMarker position={mapPos} onChange={handleMapConfirm} /><MapUpdater center={mapPos} />
          </MapContainer>
          <div style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-text-tertiary)', textAlign: 'center', background: 'var(--color-surface)', borderTop: '1px solid var(--color-border-subtle)' }}>Cliquez sur la carte ou glissez le marqueur pour ajuster</div>
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
