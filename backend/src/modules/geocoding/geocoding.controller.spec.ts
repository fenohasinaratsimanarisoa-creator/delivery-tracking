import { GeocodingController } from './geocoding.controller';
// Clés de métadonnées stockées par le décorateur @Throttle (non re-exportées par
// le package racine — import depuis les constantes internes, stable depuis v4).
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';

const mockService = {
  search: jest.fn().mockResolvedValue([]),
  reverse: jest.fn().mockResolvedValue(null),
  nearby: jest.fn().mockResolvedValue([]),
  placesAutocomplete: jest.fn().mockResolvedValue([]),
  placeDetails: jest.fn().mockResolvedValue(null),
};

describe('GeocodingController — rate limiting (proxy API externes coûteuses)', () => {
  it('porte un @Throttle strict (20 req/min par IP) sur le controller', () => {
    // Le décorateur @Throttle({ default: {...} }) stocke les métadonnées sous les clés
    // THROTTLER_LIMIT+name / THROTTLER_TTL+name (concaténées), sur la classe cible.
    // Il doit écraser le défaut global pour TOUTES les routes du controller (public,
    // proxy Google Places facturé + Nominatim 1 req/s).
    const limit = Reflect.getMetadata(THROTTLER_LIMIT + 'default', GeocodingController) as
      | number
      | undefined;
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', GeocodingController) as
      | number
      | undefined;

    expect(limit).toBe(20);
    expect(ttl).toBe(60000);
  });

  it('expose les 5 endpoints sans régression (le service est simplement délégué)', async () => {
    const service = mockService as any;
    const controller = new GeocodingController(service);

    await expect(controller.search('Antananarivo')).resolves.toEqual([]);
    await expect(controller.reverse('-18.91', '47.52')).resolves.toEqual({ label: null });
    await expect(controller.nearby('-18.91', '47.52')).resolves.toEqual([]);
    await expect(controller.placesAutocomplete('Tana')).resolves.toEqual([]);
    await expect(controller.placeDetails('abc')).resolves.toBeNull();
  });
});
