import { ConfigService } from '@nestjs/config';
import { GeocodingController } from './geocoding.controller';
import { GeocodingService } from './geocoding.service';
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
      number | undefined;
    const ttl = Reflect.getMetadata(THROTTLER_TTL + 'default', GeocodingController) as
      number | undefined;

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

describe('GeocodingController — /geocoding/health (observabilité Google Places / Nominatim)', () => {
  // Redis null => force le repli mémoire de GeocodingService, pour un test
  // déterministe sans dépendance externe (pas de Redis à monter).
  function makeService(googleApiKey: string | undefined): GeocodingService {
    const configService = {
      get: jest.fn((key: string) => (key === 'GOOGLE_MAPS_API_KEY' ? googleApiKey : undefined)),
    } as unknown as ConfigService;
    return new GeocodingService(null as any, configService);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('un échec HTTP 403 sur placesAutocomplete se reflète dans GET /geocoding/health', async () => {
    const service = makeService('test-google-key');
    jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input);
      if (url.includes('places.googleapis.com')) {
        return { ok: false, status: 403, text: async () => 'PERMISSION_DENIED' } as any;
      }
      // Ping santé Nominatim (déclenché par getHealthStatus()) : ok, hors périmètre de ce test.
      return { ok: true, json: async () => ({ display_name: 'Antananarivo' }) } as any;
    }) as unknown as typeof fetch);

    await service.placesAutocomplete('test');

    const controller = new GeocodingController(service);
    const health = await controller.health();

    expect(health.googlePlacesFailureCount24h).toBeGreaterThanOrEqual(1);
    expect(health.googlePlacesLastError).not.toBeNull();
    expect(health.googlePlacesLastError).toContain('403');
  }, 15000);

  it('googlePlacesConfigured === false si GOOGLE_MAPS_API_KEY est vide dans le ConfigService', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({}) } as any);
    const service = makeService('');
    const controller = new GeocodingController(service);

    const health = await controller.health();

    expect(health.googlePlacesConfigured).toBe(false);
  }, 15000);
});
