import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, Layers, User, Truck, Package, MapPin, SearchX, Radio } from 'lucide-react';
import api from '../services/api/client';
import { useToast } from '../components/Toast';
import RealTimeMap from '../features/map/RealTimeMap';
import Button from '../components/Button';
import styles from './MapPage.module.css';

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
      if (found) toast(t('map.toast.centered', { label: r.label }), 'info');
      setTimeout(() => { setFocusId(null); setFocusCenter(null); }, 3000);
    } else {
      toast(t('map.toast.noPosition', { label: r.label }), 'error');
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
  const typeLabels: Record<string, string> = {
    driver: t('map.results.driver'),
    vehicle: t('map.results.vehicle'),
    delivery: t('map.results.delivery'),
  };

  return (
    <div className={styles.pageWrap}>
      <RealTimeMap focusId={focusId} focusCenter={focusCenter} onVehiclesUpdate={setVehicles} />

      <div className={styles.liveChip}>
        <span className={styles.liveDot} />
        <Radio size={13} className={styles.liveIcon} />
        <span className={styles.liveText}>{t('map.live')}</span>
        <span className={styles.liveCount}>{vehicles.length}</span>
      </div>

      <div className={styles.searchContainer}>
        <div className={styles.searchBar}>
          <Search size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            value={search}
            onChange={onInputChange}
            onFocus={() => { if (results.length > 0) setOpen(true); }}
            onKeyDown={handleKeyDown}
            placeholder={t('map.searchPlaceholder')}
            className={styles.searchInput}
            aria-label={t('map.searchAria')}
          />
          {search && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setResults([]); setOpen(false); }} aria-label={t('map.clearAria')}>✕</Button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`${styles.iconButton} ${showFilters ? styles.iconButtonActive : styles.iconButtonInactive}`}
            aria-label={t('map.filterAria')}
            aria-pressed={showFilters}
          >
            <Filter size={14} />
          </button>
          <button
            className={`${styles.iconButton} ${styles.iconButtonInactive}`}
            aria-label={t('map.layersAria')}
          >
            <Layers size={14} />
          </button>
        </div>

        {open && results.length > 0 && (
          <div ref={dropdownRef} className={styles.dropdown}>
            <div className={styles.dropdownHeader}>
              <span className={styles.dropdownCount}>{results.length}</span>
              <span className={styles.dropdownTitle}>{t('map.results.title')}</span>
            </div>
            {results.map((r, i) => {
              const Icon = typeIcons[r.type];
              return (
                <button
                  key={`${r.type}-${r.id}`}
                  onClick={() => selectResult(r)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  className={`${styles.resultItem} ${i === selectedIdx ? styles.resultItemSelected : styles.resultItemDefault}`}
                >
                  <span className={`${styles.resultAvatar} ${styles[`resultAvatar${r.type.charAt(0).toUpperCase()}${r.type.slice(1)}`] || ''}`}>
                    <Icon size={14} />
                  </span>
                  <div className={styles.resultContent}>
                    <div className={styles.resultLabel}>
                      {r.label}
                    </div>
                    {r.subLabel && (
                      <div className={styles.resultSubLabel}>
                        {r.subLabel}
                      </div>
                    )}
                  </div>
                  <span className={`${styles.resultType} ${styles[`resultType${r.type.charAt(0).toUpperCase()}${r.type.slice(1)}`] || ''}`}>
                    {typeLabels[r.type]}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {open && results.length === 0 && (
          <div className={styles.noResults}>
            <SearchX size={16} className={styles.noResultsIcon} />
            <span>{t('map.noResults')}</span>
          </div>
        )}
      </div>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.legendDotMoving}`} />
          {t('map.legend.moving')}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.legendDotStopped}`} />
          {t('map.legend.stopped')}
        </span>
        <span className={styles.legendDivider} />
        <span className={styles.legendHint}>
          <MapPin size={12} />
          {t('map.legend.doubleClick')}
        </span>
      </div>
    </div>
  );
}