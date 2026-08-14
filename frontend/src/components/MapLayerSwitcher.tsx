import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { TILE_PROVIDERS, tileLayerProps } from '../features/map/tileProviders';

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
const SWITCHER_LAYERS = [
  TILE_PROVIDERS.plan,
  TILE_PROVIDERS.planDark,
  TILE_PROVIDERS.satellite,
  TILE_PROVIDERS.planLight,
];

export default function MapLayerSwitcher() {
  const map = useMap();

  useEffect(() => {
    const saved = getSavedLayer();

    const layers = SWITCHER_LAYERS.map((p) => {
      const tile = L.tileLayer(p.url, tileLayerProps(p));
      return { provider: p, tile };
    });

    const baseLayers: Record<string, L.TileLayer> = {};
    for (const { provider, tile } of layers) {
      baseLayers[provider.name] = tile;
    }

    let activeKey = layers.find((l) => l.provider.key === saved)?.provider.key ?? layers[0].provider.key;
    let active = layers.find((l) => l.provider.key === activeKey)!.tile;
    active.addTo(map);

    const control = L.control.layers(baseLayers, {}, {
      position: 'bottomleft',
      collapsed: false,
    }).addTo(map);

    map.on('baselayerchange', (e: { name: string }) => {
      const provider = layers.find((l) => l.provider.name === e.name)?.provider;
      if (provider) {
        activeKey = provider.key;
        saveLayer(provider.key);
      }
    });

    // Détection de la tuile d'erreur (« Map data not yet available » / HTTP 403-404) :
    // certains fournisseurs (ex. OSM) bloquent les User-Agent non standards. On bascule
    // automatiquement vers la couche CARTO retina si la couche active échoue.
    let fallbackApplied = false;
    const applyFallback = () => {
      if (fallbackApplied) return;
      const activeProvider = layers.find((l) => l.provider.key === activeKey)?.provider;
      if (!activeProvider || activeProvider.key === 'plan') return;
      fallbackApplied = true;
      const plan = layers.find((l) => l.provider.key === 'plan')!;
      if (active !== plan.tile) {
        map.removeLayer(active);
        plan.tile.addTo(map);
        active = plan.tile;
        console.warn('[map] tuiles bloquées (rate-limit) — bascule sur le repli CARTO');
      }
    };

    let tileErrorCount = 0;
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const onTileError = (e: L.LeafletEvent) => {
      const tile = (e as { tile?: HTMLImageElement }).tile as HTMLImageElement | undefined;
      if (!tile) return;
      tileErrorCount++;
      if (errorTimer) clearTimeout(errorTimer);
      // Plusieurs échecs de tuiles en peu de temps = blocage du fournisseur courant.
      errorTimer = setTimeout(() => {
        if (tileErrorCount >= 3) {
          applyFallback();
        }
        tileErrorCount = 0;
      }, 4000);
    };
    map.on('tileerror', onTileError);

    return () => {
      control.remove();
      map.off('tileerror', onTileError);
      if (errorTimer) clearTimeout(errorTimer);
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
      });
    };
  }, [map]);

  return null;
}
