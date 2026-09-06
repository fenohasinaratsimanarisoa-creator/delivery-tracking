import { describe, it, expect } from 'vitest';
import { TILE_PROVIDERS, tileLayerProps, isSatelliteHDAvailable } from './tileProviders';

describe('tileProviders (qualité 4K / HiDPI)', () => {
  it('expose les 5 couches attendues', () => {
    expect(Object.keys(TILE_PROVIDERS)).toEqual([
      'plan',
      'planDark',
      'planLight',
      'satellite',
      'satelliteHD',
    ]);
  });

  it('satelliteHD (Mapbox) : url vide et indisponible sans token au build (cas de ce test)', () => {
    // VITE_MAPBOX_TOKEN n'est pas défini dans l'environnement de test — reflète
    // le comportement réel d'un déploiement sans le token configuré.
    expect(isSatelliteHDAvailable).toBe(false);
    expect(TILE_PROVIDERS.satelliteHD.url).toBe('');
  });

  // CARTO (l'ancien fournisseur de "plan"/"planDark") a fermé son accès
  // anonyme le 2026-09-06 (tuiles remplacées par un watermark "API KEY
  // REQUIRED", constaté en prod). "plan"/"planDark" utilisent maintenant les
  // styles Mapbox (même token que satelliteHD) quand disponible, sinon un
  // repli OpenStreetMap brut (garanti sans clé). Comme satelliteHD ci-dessus,
  // VITE_MAPBOX_TOKEN n'est pas défini dans l'environnement de test — ces
  // tests couvrent donc le chemin de repli OSM réellement exercé ici.
  it('« plan » sans token Mapbox retombe sur OpenStreetMap brut (pas de retina, pas de {r})', () => {
    expect(TILE_PROVIDERS.plan.url).toBe(TILE_PROVIDERS.planLight.url);
    expect(TILE_PROVIDERS.plan.url).not.toContain('{r}');
    expect(TILE_PROVIDERS.plan.detectRetina).toBeUndefined();
    expect(TILE_PROVIDERS.plan.maxNativeZoom).toBe(19);
  });

  it('« planDark » sans token Mapbox retombe aussi sur OpenStreetMap brut', () => {
    expect(TILE_PROVIDERS.planDark.url).toBe(TILE_PROVIDERS.planLight.url);
    expect(TILE_PROVIDERS.planDark.detectRetina).toBeUndefined();
  });

  it('ne force PAS le retina sur les fournisseurs qui ne le servent pas (OSM)', () => {
    expect(TILE_PROVIDERS.planLight.detectRetina).toBeUndefined();
    expect(TILE_PROVIDERS.planLight.url).not.toContain('{r}');
  });

  it('le satellite Esri borne la résolution native pour éviter le placeholder', () => {
    expect(TILE_PROVIDERS.satellite.maxNativeZoom).toBe(17);
    expect(TILE_PROVIDERS.satellite.maxZoom).toBeGreaterThan(TILE_PROVIDERS.satellite.maxNativeZoom!);
  });

  it('tileLayerProps est compatible react-leaflet et L.tileLayer', () => {
    const props = tileLayerProps(TILE_PROVIDERS.plan);
    expect(props.url).toBe(TILE_PROVIDERS.plan.url);
    expect(props.attribution).toBe(TILE_PROVIDERS.plan.attribution);
    expect(props.maxZoom).toBe(TILE_PROVIDERS.plan.maxZoom);
    expect(props.maxNativeZoom).toBe(19);

    const sat = tileLayerProps(TILE_PROVIDERS.satellite);
    expect(sat.maxNativeZoom).toBe(17);
    expect(sat.detectRetina).toBeUndefined();
  });
});
