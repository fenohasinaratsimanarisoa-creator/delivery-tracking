import { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { Layers, Check } from 'lucide-react';
import {
  TILE_PROVIDERS,
  tileLayerProps,
  isSatelliteHDAvailable,
  type TileProviderConfig,
} from '../features/map/tileProviders';
import styles from './MapLayerSwitcher.module.css';

const STORAGE_KEY = 'dt_map_layer';

function getSavedLayer(): string {
  try { return localStorage.getItem(STORAGE_KEY) || 'plan'; } catch { return 'plan'; }
}
function saveLayer(layer: string) {
  try { localStorage.setItem(STORAGE_KEY, layer); } catch {}
}

// Couches exposées dans le sélecteur. La couche par défaut (« Plan ») est CARTO
// voyager avec tuiles @2x (retina) : nette sur écrans 4K/HiDPI, là où OSM 256px
// était étirée et floue. La couche « Sombre » colle au thème sombre de l'app.
//
// Satellite : UNE SEULE entrée « Satellite » dans le sélecteur, jamais deux —
// avant, « Satellite » (imagerie Esri brute, SANS aucun nom de lieu) et
// « Satellite HD » (Mapbox, avec labels superposés) coexistaient, et rien ne
// signalait à l'utilisateur laquelle choisir pour avoir les noms de lieux
// visibles (demande explicite : lisibilité type Google Maps hybride). Quand un
// token Mapbox est configuré, l'entrée « Satellite » pointe directement vers
// la version labellisée (satelliteHD) ; sinon repli sur Esri (fonctionnel mais
// sans texte, mieux que rien sans compte Mapbox).
const SWITCHER_LAYERS = [
  TILE_PROVIDERS.plan,
  TILE_PROVIDERS.planDark,
  isSatelliteHDAvailable
    ? { ...TILE_PROVIDERS.satelliteHD, key: 'satellite', name: TILE_PROVIDERS.satellite.name }
    : TILE_PROVIDERS.satellite,
  TILE_PROVIDERS.planLight,
];

// AUDIT DESIGN MOBILE 2026-09-16 : ce composant utilisait le contrôle natif
// Leaflet (`L.control.layers`, `collapsed: false`) — un widget non stylé,
// TOUJOURS déployé, positionné par Leaflet lui-même (bottomleft) sans
// coordination avec les autres overlays de la carte (légende de statut,
// barre de recherche). Sur mobile, ce gros bloc blanc permanent se
// superposait à la légende de statut (les deux ancrés près du bas de
// l'écran) — capture utilisateur à l'appui. Remplacé par un vrai contrôle
// React repliable (bouton pilule → popover), cohérent avec le reste du
// design de la carte, qui ne prend de la place que lorsqu'on l'ouvre.
export default function MapLayerSwitcher() {
  const map = useMap();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(() => getSavedLayer());
  const containerRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<{ provider: TileProviderConfig; tile: L.TileLayer }[]>([]);
  const activeTileRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const layers = SWITCHER_LAYERS.map((p) => ({ provider: p, tile: L.tileLayer(p.url, tileLayerProps(p)) }));
    layersRef.current = layers;

    const saved = getSavedLayer();
    const initial = layers.find((l) => l.provider.key === saved) ?? layers[0];
    initial.tile.addTo(map);
    activeTileRef.current = initial.tile;
    setActiveKey(initial.provider.key);

    // Détection de la tuile d'erreur (« Map data not yet available » / HTTP 403-404) :
    // certains fournisseurs (ex. OSM) bloquent les User-Agent non standards. On bascule
    // automatiquement vers la couche CARTO retina si la couche active échoue.
    let fallbackApplied = false;
    const applyFallback = () => {
      if (fallbackApplied) return;
      const current = layersRef.current.find((l) => l.tile === activeTileRef.current);
      if (!current || current.provider.key === 'plan') return;
      fallbackApplied = true;
      const plan = layersRef.current.find((l) => l.provider.key === 'plan')!;
      if (activeTileRef.current && activeTileRef.current !== plan.tile) {
        map.removeLayer(activeTileRef.current);
        plan.tile.addTo(map);
        activeTileRef.current = plan.tile;
        setActiveKey('plan');
        saveLayer('plan');
        console.warn('[map] tuiles bloquées (rate-limit) — bascule sur le repli CARTO');
      }
    };

    let tileErrorCount = 0;
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const onTileError = () => {
      tileErrorCount++;
      if (errorTimer) clearTimeout(errorTimer);
      // Plusieurs échecs de tuiles en peu de temps = blocage du fournisseur courant.
      errorTimer = setTimeout(() => {
        if (tileErrorCount >= 3) applyFallback();
        tileErrorCount = 0;
      }, 4000);
    };
    map.on('tileerror', onTileError);

    return () => {
      map.off('tileerror', onTileError);
      if (errorTimer) clearTimeout(errorTimer);
      layers.forEach(({ tile }) => {
        if (map.hasLayer(tile)) map.removeLayer(tile);
      });
    };
  }, [map]);

  // Ferme au clic/tap extérieur — comportement standard d'un menu popover.
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('touchstart', onOutside);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('touchstart', onOutside);
    };
  }, [open]);

  const selectLayer = (key: string) => {
    setOpen(false);
    if (key === activeKey) return;
    const target = layersRef.current.find((l) => l.provider.key === key);
    if (!target) return;
    if (activeTileRef.current) map.removeLayer(activeTileRef.current);
    target.tile.addTo(map);
    activeTileRef.current = target.tile;
    setActiveKey(key);
    saveLayer(key);
  };

  const activeProvider = SWITCHER_LAYERS.find((p) => p.key === activeKey) ?? SWITCHER_LAYERS[0];

  return (
    <div ref={containerRef} className={styles.wrap}>
      {open && (
        <div className={styles.panel} role="menu">
          {SWITCHER_LAYERS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="menuitemradio"
              aria-checked={p.key === activeKey}
              className={`${styles.option} ${p.key === activeKey ? styles.optionActive : ''}`}
              onClick={() => selectLayer(p.key)}
            >
              <span>{p.name}</span>
              {p.key === activeKey && <Check size={14} className={styles.optionCheck} />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('map.layersAria')}
        aria-expanded={open}
      >
        <Layers size={15} />
        <span className={styles.toggleLabel}>{activeProvider.name}</span>
      </button>
    </div>
  );
}
