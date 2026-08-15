export interface TileProviderConfig {
  key: string;
  name: string;
  url: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom?: number;
  detectRetina?: boolean;
}

// Config centralisée des tuiles. Les écrans 4K/HiDPI affichent ~2x plus de
// pixels : les fournisseurs qui le supportent exposent des tuiles @2x via le
// placeholder {r} (CARTO). `detectRetina` fait remplacer {r} par '@2x' quand
// devicePixelRatio >= 2 → carte nette au lieu d'un étirement flou des tuiles 256px.
export const TILE_PROVIDERS: Record<'plan' | 'planDark' | 'planLight' | 'satellite', TileProviderConfig> = {
  plan: {
    key: 'plan',
    name: 'Plan',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 20,
    detectRetina: true,
  },
  planDark: {
    key: 'planDark',
    name: 'Sombre',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_matter/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 20,
    detectRetina: true,
  },
  planLight: {
    key: 'planLight',
    name: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
    // OSM ne sert pas de tuiles au-delà de 19 : maxNativeZoom aligné pour que le
    // conteneur (maxZoom 20, aligné sur CARTO) agrandisse la dernière tuile
    // valide au lieu d'upscaler en flou ou de demander des tuiles 404.
    maxNativeZoom: 19,
  },
  satellite: {
    key: 'satellite',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    // Esri ne génère pas de tuiles au-delà de 17 : Leaflet agrandit alors la
    // dernière tuile valide (maxNativeZoom) au lieu d'afficher le placeholder.
    maxZoom: 20,
    maxNativeZoom: 17,
  },
};

// Props compatibles à la fois avec <TileLayer> (react-leaflet) et L.tileLayer(url, opts).
export function tileLayerProps(p: TileProviderConfig) {
  return {
    url: p.url,
    attribution: p.attribution,
    maxZoom: p.maxZoom,
    ...(p.maxNativeZoom ? { maxNativeZoom: p.maxNativeZoom } : {}),
    ...(p.detectRetina ? { detectRetina: true } : {}),
  };
}
