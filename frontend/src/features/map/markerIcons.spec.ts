import { describe, it, expect } from 'vitest';
import L from 'leaflet';
import { enableRetinaDefaultMarker, createPinIcon } from './markerIcons';

describe('markerIcons (qualité 4K / HiDPI)', () => {
  it('active le marqueur par défaut en version @2x (retina) sans casser le 1x', () => {
    enableRetinaDefaultMarker();
    const opts = L.Icon.Default.prototype.options;
    expect(opts.iconRetinaUrl).toContain('marker-icon-2x');
    expect(opts.iconUrl).toContain('marker-icon.png');
    expect(opts.shadowUrl).toContain('marker-shadow.png');
  });

  it('crée un pin SVG vectoriel (pas de PNG raster), ancré sur la pointe', () => {
    const pin = createPinIcon('var(--color-red)');
    expect(pin.options.iconSize).toEqual([28, 40]);
    expect(pin.options.iconAnchor).toEqual([14, 38]);
    const html = pin.options.html as string;
    expect(html).toContain('<svg');
    expect(html).toContain('var(--color-red)');
    expect(html).not.toContain('.png');
  });
});
