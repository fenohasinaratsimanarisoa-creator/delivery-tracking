import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { TILE_PROVIDERS, tileLayerProps } from './tileProviders';

// Couche CARTO voyager @2x (retina) par défaut : nette sur écrans 4K/HiDPI. Si le
// fournisseur rate-limite ou juge le User-Agent non standard, on retombe sur la
// couche OSM classique (et inversement). Les deux restent fonctionnels pour les
// apps de production avec un usage raisonnable.
const ERROR_THRESHOLD = 3;
const ERROR_WINDOW_MS = 4000;

export default function ResilientTileLayer() {
  const map = useMap();
  const appliedRef = useRef(false);

  useEffect(() => {
    const primary = L.tileLayer(TILE_PROVIDERS.plan.url, tileLayerProps(TILE_PROVIDERS.plan));
    primary.addTo(map);

    let errors = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onTileError = (e: L.LeafletEvent) => {
      const tile = (e as { tile?: HTMLImageElement }).tile as HTMLImageElement | undefined;
      if (!tile) return;
      errors++;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (errors >= ERROR_THRESHOLD && !appliedRef.current) {
          appliedRef.current = true;
          map.removeLayer(primary);
          L.tileLayer(TILE_PROVIDERS.planLight.url, tileLayerProps(TILE_PROVIDERS.planLight)).addTo(map);
          console.warn('[map] tuiles CARTO bloquées — repli OpenStreetMap activé');
        }
        errors = 0;
      }, ERROR_WINDOW_MS);
    };

    map.on('tileerror', onTileError);
    return () => {
      map.off('tileerror', onTileError);
      if (timer) clearTimeout(timer);
      map.eachLayer((layer) => {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
      });
    };
  }, [map]);

  return null;
}
