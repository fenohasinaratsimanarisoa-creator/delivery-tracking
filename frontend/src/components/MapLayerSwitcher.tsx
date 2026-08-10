import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const TILE_PROVIDERS = {
  plan: {
    name: 'Plan',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  // Repli automatique si OpenStreetMap rate-limite (elle renvoie alors la tuile d'erreur
  // « Map data not yet available »). CARTO basemaps (plan) et Esri (satellite) restent
  // fonctionnels pour les apps de production avec un usage raisonnable.
  planFallback: {
    name: 'Plan (repli)',
    url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  satellite: {
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    // Au-delà de maxNativeZoom, Esri n'a pas de tuile générée pour toutes les zones : elle
    // renvoie quand même un HTTP 200 avec un placeholder « Map data not yet available »
    // (pas une erreur réseau → `tileerror` ne se déclenche jamais). Avec maxNativeZoom +
    // maxZoom, Leaflet agrandit automatiquement la dernière tuile valide au lieu d'afficher
    // le placeholder gris.
    maxNativeZoom: 17,
    maxZoom: 20,
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
    const planFallback = L.tileLayer(TILE_PROVIDERS.planFallback.url, { attribution: TILE_PROVIDERS.planFallback.attribution });
    const satellite = L.tileLayer(TILE_PROVIDERS.satellite.url, {
      attribution: TILE_PROVIDERS.satellite.attribution,
      maxNativeZoom: TILE_PROVIDERS.satellite.maxNativeZoom,
      maxZoom: TILE_PROVIDERS.satellite.maxZoom,
    });

    const baseLayers: Record<string, L.TileLayer> = {
      [TILE_PROVIDERS.plan.name]: plan,
      [TILE_PROVIDERS.satellite.name]: satellite,
    };

    let active = saved === 'satellite' ? satellite : plan;
    active.addTo(map);

    const control = L.control.layers(baseLayers, {}, {
      position: 'bottomleft',
      collapsed: false,
    }).addTo(map);

    map.on('baselayerchange', (e: { name: string }) => {
      saveLayer(e.name === TILE_PROVIDERS.satellite.name ? 'satellite' : 'plan');
    });

    // Détection de la tuile d'erreur OpenStreetMap (« Map data not yet available ») :
    // OSM renvoie une image quasi-blanche uniforme quand elle rate-limite ou juge le
    // User-Agent non standard. On bascule alors automatiquement sur le repli CARTO.
    let fallbackApplied = false;
    const applyFallback = () => {
      if (fallbackApplied) return;
      fallbackApplied = true;
      if (active !== satellite) {
        map.removeLayer(plan);
        planFallback.addTo(map);
        active = planFallback;
        console.warn('[map] tuiles OSM bloquées (rate-limit) — bascule sur le repli CARTO');
      }
    };

    let tileErrorCount = 0;
    let errorTimer: ReturnType<typeof setTimeout> | null = null;
    const onTileError = (e: L.LeafletEvent) => {
      const tile = (e as { tile?: HTMLImageElement }).tile as HTMLImageElement | undefined;
      if (!tile) return;
      tileErrorCount++;
      if (errorTimer) clearTimeout(errorTimer);
      // Plusieurs échecs de tuiles en peu de temps = blocage OSM.
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
