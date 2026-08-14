import { describe, it, expect } from 'vitest';
import { TILE_PROVIDERS, tileLayerProps } from './tileProviders';

describe('tileProviders (qualité 4K / HiDPI)', () => {
  it('expose les 4 couches attendues', () => {
    expect(Object.keys(TILE_PROVIDERS)).toEqual(['plan', 'planDark', 'planLight', 'satellite']);
  });

  it('la couche par défaut « plan » est une tuile CARTO retina (@2x via {r})', () => {
    expect(TILE_PROVIDERS.plan.url).toContain('{r}');
    expect(TILE_PROVIDERS.plan.detectRetina).toBe(true);
    expect(TILE_PROVIDERS.plan.maxZoom).toBeGreaterThanOrEqual(19);
  });

  it('la couche sombre colle au thème et reste retina', () => {
    expect(TILE_PROVIDERS.planDark.url).toContain('dark_matter');
    expect(TILE_PROVIDERS.planDark.url).toContain('{r}');
    expect(TILE_PROVIDERS.planDark.detectRetina).toBe(true);
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
    expect(props.detectRetina).toBe(true);

    const sat = tileLayerProps(TILE_PROVIDERS.satellite);
    expect(sat.maxNativeZoom).toBe(17);
    expect(sat.detectRetina).toBeUndefined();
  });
});
