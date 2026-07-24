import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Layers, User, Truck, Package } from 'lucide-react';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import RealTimeMap from '../features/map/RealTimeMap';
import Button from '../components/Button';

interface SearchResult {
  type: 'driver' | 'vehicle' | 'delivery';
  id: string;
  label: string;
  subLabel?: string;
  lat?: number;
  lng?: number;
}

export default function MapPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusCenter, setFocusCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchDeliveries = async () => {
      try {
        const res = await api.get('/deliveries?page=1&limit=50');
        setDeliveries(res.data?.data || []);
      } catch {}
    };
    fetchDeliveries();
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    const lower = q.toLowerCase();
    const matches: SearchResult[] = [];

    for (const v of vehicles) {
      if (v.name?.toLowerCase().includes(lower)) {
        matches.push({ type: 'driver', id: v.id, label: v.name, subLabel: v.speed ? `${(v.speed * 3.6).toFixed(0)} km/h` : 'À l\'arrêt', lat: v.lat, lng: v.lng });
      }
    }

    for (const d of deliveries) {
      if (d.title?.toLowerCase().includes(lower) || d.deliveryAddress?.toLowerCase().includes(lower) || d.pickupAddress?.toLowerCase().includes(lower)) {
        matches.push({ type: 'delivery', id: d.id, label: d.title, subLabel: d.deliveryAddress, lat: d.deliveryLat || d.pickupLat, lng: d.deliveryLng || d.pickupLng });
      }
    }

    setResults(matches);
    setOpen(matches.length > 0);
    setSelectedIdx(-1);
  }, [vehicles, deliveries]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearch(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(q), 200);
  };

  const selectResult = (r: SearchResult) => {
    setSearch(r.label);
    setOpen(false);
    setResults([]);
    if (r.lat && r.lng) {
      setFocusId(r.id);
      setFocusCenter({ lat: r.lat, lng: r.lng });
      const found = vehicles.find((v) => v.id === r.id);
      if (found) toast(`Centrage sur ${r.label}`, 'info');
      setTimeout(() => { setFocusId(null); setFocusCenter(null); }, 3000);
    } else {
      toast(`Aucune position disponible pour ${r.label}`, 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((p) => (p < results.length - 1 ? p + 1 : 0)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((p) => (p > 0 ? p - 1 : results.length - 1)); }
    if (e.key === 'Enter' && selectedIdx >= 0) { e.preventDefault(); selectResult(results[selectedIdx]); }
    if (e.key === 'Escape') { setOpen(false); }
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    return () => { clearTimeout(debounceRef.current); };
  }, []);

  const typeIcons: Record<string, React.ElementType> = { driver: User, vehicle: Truck, delivery: Package };
  const typeLabels: Record<string, string> = { driver: 'Chauffeur', vehicle: 'Véhicule', delivery: 'Livraison' };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <RealTimeMap focusId={focusId} focusCenter={focusCenter} onVehiclesUpdate={setVehicles} />

      <div style={{
        position: 'absolute', top: 'var(--space-lg)', left: 'var(--space-lg)',
        right: 'var(--space-lg)', maxWidth: 480,
        zIndex: 1000,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-sm)',
          padding: 'var(--space-sm) var(--space-md)',
          background: 'var(--color-glass)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid var(--color-glass-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-sm)',
        }}>
          <Search size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={search}
            onChange={onInputChange}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder={t('map.searchPlaceholder')}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text)',
              fontSize: 'var(--text-sm)',
              fontFamily: 'var(--font-body)',
              outline: 'none',
              padding: 'var(--space-xs) 0',
            }}
            aria-label={t('map.searchAria')}
          />
          {search && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setResults([]); setOpen(false); }}>✕</Button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            style={{
              background: 'var(--color-surface-alt)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer', padding: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: showFilters ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}
            aria-label={t('map.filterAria')}
            aria-pressed={showFilters}
          >
            <Filter size={14} />
          </button>
          <button
            style={{
              background: 'var(--color-surface-alt)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer', padding: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-text-tertiary)',
            }}
            aria-label={t('map.layersAria')}
          >
            <Layers size={14} />
          </button>
        </div>

        {open && results.length > 0 && (
          <div ref={dropdownRef} style={{
            marginTop: 4, maxHeight: 320, overflow: 'auto',
            background: 'var(--color-glass)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--color-glass-border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-lg)',
          }}>
            {results.map((r, i) => {
              const Icon = typeIcons[r.type];
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => selectResult(r)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 14px',
                    border: 'none', borderBottom: i < results.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    background: i === selectedIdx ? 'var(--color-accent-muted)' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                    color: 'var(--color-text)',
                    fontSize: '0.8rem',
                    fontFamily: 'var(--font-body)',
                  }}
                >
                  <Icon size={14} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.label}
                    </div>
                    {r.subLabel && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                        {r.subLabel}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 600, textTransform: 'uppercase',
                    padding: '2px 6px', borderRadius: 4,
                    background: 'var(--color-surface-alt)',
                    color: 'var(--color-text-tertiary)',
                    flexShrink: 0,
                  }}>
                    {typeLabels[r.type]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {open && results.length === 0 && (
          <div style={{
            marginTop: 4, padding: '12px 16px',
            background: 'var(--color-glass)', backdropFilter: 'blur(12px)',
            border: '1px solid var(--color-glass-border)',
            borderRadius: 'var(--radius-lg)',
            fontSize: '0.8rem', color: 'var(--color-text-tertiary)',
            textAlign: 'center',
          }}>
            Aucun résultat — essayez un nom, une plaque ou une adresse
          </div>
        )}
      </div>

      <div style={{
        position: 'absolute', bottom: 'var(--space-lg)',
        left: '50%', transform: 'translateX(-50%)',
        padding: 'var(--space-sm) var(--space-lg)',
        background: 'var(--color-glass)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid var(--color-glass-border)',
        borderRadius: 'var(--radius-full)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', gap: 'var(--space-lg)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-secondary)',
      }}>
        <span>🟡 <span style={{ fontFamily: 'var(--font-body)' }}>{t('map.legend.moving')}</span></span>
        <span>🟢 <span style={{ fontFamily: 'var(--font-body)' }}>{t('map.legend.stopped')}</span></span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
          {t('map.legend.doubleClick')}
        </span>
      </div>
    </div>
  );
}
