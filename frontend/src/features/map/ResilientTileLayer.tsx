import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// OpenStreetMap renvoie la tuile d'erreur « Map data not yet available » (image quasi
// blanche) quand elle rate-limite ou juge le User-Agent non standard. Ce composant
// ajoute une couche OSM et, si plusieurs tuiles échouent en peu de temps, bascule
// automatiquement sur un repli CARTO (fiable pour les apps de production).
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const FALLBACK_URL = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const FALLBACK_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO';

const ERROR_THRESHOLD = 3;
const ERROR_WINDOW_MS = 4000;

export default function ResilientTileLayer() {
  const map = useMap();
  const appliedRef = useRef(false);

  useEffect(() => {
    const osm = L.tileLayer(OSM_URL, { attribution: OSM_ATTR });
    osm.addTo(map);

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
          map.removeLayer(osm);
          L.tileLayer(FALLBACK_URL, { attribution: FALLBACK_ATTR }).addTo(map);
          console.warn('[map] tuiles OSM bloquées — repli CARTO activé');
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
