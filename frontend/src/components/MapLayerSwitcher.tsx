import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const TILE_PROVIDERS = {
  plan: {
    name: 'Plan',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
  },
};

const STORAGE_KEY = 'dt_map_layer';

function getSavedLayer(): string {
  try { return localStorage.getItem(STORAGE_KEY) || 'plan'; } catch { return 'plan'; }
}
function saveLayer(layer: string) {
  try { localStorage.setItem(STORAGE_KEY, layer); } catch {}
}

export default function MapLayerSwitcher() {
  const map = useMap();

  useEffect(() => {
    const saved = getSavedLayer();
    const plan = L.tileLayer(TILE_PROVIDERS.plan.url, { attribution: TILE_PROVIDERS.plan.attribution });
    const satellite = L.tileLayer(TILE_PROVIDERS.satellite.url, { attribution: TILE_PROVIDERS.satellite.attribution });

    const baseLayers: Record<string, L.TileLayer> = {
      [TILE_PROVIDERS.plan.name]: plan,
      [TILE_PROVIDERS.satellite.name]: satellite,
    };

    const active = saved === 'satellite' ? satellite : plan;
    active.addTo(map);

    const control = L.control.layers(baseLayers, {}, {
      position: 'bottomleft',
      collapsed: false,
    }).addTo(map);

    map.on('baselayerchange', (e: { name: string }) => {
      saveLayer(e.name === TILE_PROVIDERS.satellite.name ? 'satellite' : 'plan');
    });

    return () => {
      control.remove();
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
      });
    };
  }, [map]);

  return null;
}
