import { ConfigService } from '@nestjs/config';
import { GeocodingService } from './geocoding.service';

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'GOOGLE_MAPS_API_KEY') return 'test-google-key';
    return undefined;
  }),
};

function mockFetchOnce(data: unknown, ok = true) {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as any);
}

describe('GeocodingService', () => {
  let service: GeocodingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GeocodingService(mockRedis as any, mockConfigService as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('placesAutocomplete', () => {
    it('returns cached results when available', async () => {
      const cached = [
        { placeId: 'abc', description: 'Test', mainText: 'Test', secondaryText: 'MG' },
      ];
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.placesAutocomplete('Antananarivo');

      expect(result).toEqual(cached);
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('returns empty array for empty input', async () => {
      const result = await service.placesAutocomplete('');

      expect(result).toEqual([]);
    });

    it('fetches from Google Places API and caches results', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const suggestions = [
        {
          placePrediction: {
            placeId: 'abc',
            text: { text: 'Antananarivo' },
            structuredFormat: { mainText: { text: 'Antananarivo' }, secondaryText: { text: 'MG' } },
          },
        },
      ];
      mockFetchOnce({ suggestions }, true);

      const result = await service.placesAutocomplete('Antananarivo');

      expect(result).toHaveLength(1);
      expect(result[0].placeId).toBe('abc');
      expect(mockRedis.set).toHaveBeenCalled();
    });

    it('logs error and returns empty on 403/PERMISSION_DENIED', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      const errorSpy = jest.spyOn(service['logger'], 'error').mockImplementation(() => {});
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: 'PERMISSION_DENIED' } }),
      } as any);

      const result = await service.placesAutocomplete('test');

      expect(result).toEqual([]);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Google Places API HTTP 403'));
      expect(mockRedis.set).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('placeDetails', () => {
    it('returns null when googleApiKey is not set', async () => {
      const noKeyService = new GeocodingService(
        null as any,
        { get: jest.fn(() => undefined) } as unknown as ConfigService,
      );

      const result = await noKeyService.placeDetails('abc');

      expect(result).toBeNull();
    });

    it('fetches place details from Google Places API', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockFetchOnce(
        {
          location: { latitude: -18.91, longitude: 47.52 },
          formattedAddress: 'Antananarivo, Madagascar',
          displayName: { text: 'Antananarivo' },
        },
        true,
      );

      const result = await service.placeDetails('abc');

      expect(result).toMatchObject({
        lat: -18.91,
        lng: 47.52,
        address: 'Antananarivo, Madagascar',
        name: 'Antananarivo',
      });
    });
  });

  describe('search', () => {
    it('returns empty array for empty query', async () => {
      const result = await service.search('');

      expect(result).toEqual([]);
    });

    it('performs geocoding search via Nominatim', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockFetchOnce(
        [
          {
            lat: '-18.91',
            lon: '47.52',
            display_name: 'Antananarivo, Madagascar',
            name: 'Antananarivo',
            address: { city: 'Antananarivo', country: 'Madagascar' },
          },
        ],
        true,
      );

      const result = await service.search('Antananarivo');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({
        lat: -18.91,
        lng: 47.52,
      });
    });

    it('reads from cache when available', async () => {
      const cached = [{ lat: -18.91, lng: 47.52, label: 'Tana', displayName: 'Antananarivo' }];
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));

      const result = await service.search('Antananarivo');

      expect(result).toEqual(cached);
    });
  });

  describe('reverse', () => {
    it('returns display_name from Nominatim reverse geocode', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockFetchOnce({ display_name: 'Antananarivo, Madagascar' }, true);

      const result = await service.reverse(-18.91, 47.52);

      expect(result).toBe('Antananarivo, Madagascar');
    });

    it('returns null on fetch failure', async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      mockFetchOnce(null, false);

      const result = await service.reverse(-18.91, 47.52);

      expect(result).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Correctifs autocomplétion Madagascar : bbox hémisphère sud, filtrage pays
// réel (countrycodes + bounded), et throttle ~1 req/s exigé par Nominatim.
// ─────────────────────────────────────────────────────────────────────────────

// Redis à null : force de VRAIS appels réseau (simulés) à chaque test — sinon le
// cache court-circuiterait fetch() et les assertions ne vérifieraient plus rien.
function makeUncachedService(): GeocodingService {
  return new GeocodingService(
    null as any,
    {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService,
  );
}

function nominatimItem(lat: number, lon: number) {
  return {
    lat: String(lat),
    lon: String(lon),
    display_name: 'Ambohipo, Antananarivo, Madagascar',
    name: 'Ambohipo',
    address: { suburb: 'Ambohipo', city: 'Antananarivo' },
  };
}

/**
 * Enregistre chaque URL appelée + l'instant du départ.
 * `items` : nombre de résultats renvoyés (10+ fait sortir search() de sa boucle
 * après UNE seule requête — indispensable pour compter précisément les appels).
 */
function recordFetchCalls(items = 10) {
  const calls: { url: string; at: number }[] = [];
  jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown) => {
    calls.push({ url: String(input), at: Date.now() });
    return {
      ok: true,
      json: async () =>
        Array.from({ length: items }, (_, i) => nominatimItem(-18.9 - i * 0.01, 47.5 + i * 0.01)),
    };
  }) as unknown as typeof fetch);
  return calls;
}

describe('GeocodingService — ciblage Madagascar (Nominatim)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("search() envoie countrycodes=mg sur l'URL Nominatim", async () => {
    const calls = recordFetchCalls();
    await makeUncachedService().search('Ambohipo');

    expect(calls.length).toBeGreaterThan(0);
    const url = new URL(calls[0].url);
    expect(url.origin).toBe('https://nominatim.openstreetmap.org');
    expect(url.searchParams.get('countrycodes')).toBe('mg');
  });

  it('le premier appel (celui qui porte le viewbox) contient bounded=1', async () => {
    const calls = recordFetchCalls();
    await makeUncachedService().search('Ambohipo');

    const url = new URL(calls[0].url);
    // viewbox et bounded vont de pair : viewbox seul n'est qu'un critère de tri.
    expect(url.searchParams.get('viewbox')).toBeTruthy();
    expect(url.searchParams.get('bounded')).toBe('1');
  });

  it("la bbox Madagascar est dans l'hémisphère sud (-11, jamais +11)", async () => {
    const calls = recordFetchCalls();
    await makeUncachedService().search('Ambohipo');

    const viewbox = new URL(calls[0].url).searchParams.get('viewbox') as string;
    expect(viewbox).toContain('-11');
    expect(viewbox).not.toMatch(/,11,/);

    // Toutes les latitudes de la bbox doivent être négatives : Madagascar va de
    // -11.9 à -25.6. Format Nominatim : <lon1>,<lat1>,<lon2>,<lat2>.
    const [, lat1, , lat2] = viewbox.split(',').map(Number);
    expect(lat1).toBeLessThan(0);
    expect(lat2).toBeLessThan(0);
  });

  // Timeout élargi : 0 résultat force la boucle principale (3 requêtes) PUIS la
  // boucle de repli (3 requêtes), chacune espacée de 1100ms par le throttle →
  // ~6,6s incompressibles. C'est le comportement voulu, pas une lenteur subie.
  it('les requêtes de repli portent aussi countrycodes=mg', async () => {
    const calls = recordFetchCalls(0);
    await makeUncachedService().search('Lot II B 45 Ambohipo');

    expect(calls.length).toBeGreaterThan(1);
    // Au moins une requête de repli (limit=10) doit avoir été émise, en plus de
    // la boucle principale (limit=20) — sinon on ne testerait pas le repli.
    expect(calls.some((c) => new URL(c.url).searchParams.get('limit') === '10')).toBe(true);
    for (const call of calls) {
      expect(new URL(call.url).searchParams.get('countrycodes')).toBe('mg');
    }
  }, 30000);
});

describe('GeocodingService — throttle Nominatim (~1 req/s)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sérialise deux search() concurrents à >= ~1100ms entre les départs', async () => {
    const calls = recordFetchCalls();
    const service = makeUncachedService();

    // Deux requêtes concurrentes, termes DIFFÉRENTS (clés de cache distinctes —
    // de toute façon Redis est null ici).
    await Promise.all([service.search('Ambohipo'), service.search('Analakely')]);

    expect(calls).toHaveLength(2);
    const gap = calls[1].at - calls[0].at;
    // 1100ms visés ; marge de 100ms pour l'imprécision des timers Node.
    expect(gap).toBeGreaterThanOrEqual(1000);
  }, 20000);

  it('espace aussi des appels de méthodes différentes (file partagée)', async () => {
    const calls = recordFetchCalls();
    const service = makeUncachedService();

    // reverse() puis search() : le throttle est au niveau du module, pas de la
    // méthode — les deux passent par la MÊME file.
    await Promise.all([service.reverse(-18.91, 47.52), service.search('Ambohipo')]);

    expect(calls.length).toBeGreaterThanOrEqual(2);
    const gap = calls[1].at - calls[0].at;
    expect(gap).toBeGreaterThanOrEqual(1000);
  }, 20000);

  it('un appel en échec ne bloque pas définitivement la file', async () => {
    const calls: { url: string; at: number }[] = [];
    let first = true;
    jest.spyOn(global, 'fetch').mockImplementation((async (input: unknown) => {
      calls.push({ url: String(input), at: Date.now() });
      if (first) {
        first = false;
        throw new Error('network down');
      }
      return {
        ok: true,
        json: async () =>
          Array.from({ length: 10 }, (_, i) => nominatimItem(-18.9 - i * 0.01, 47.5)),
      };
    }) as unknown as typeof fetch);

    const service = makeUncachedService();
    // Le 1er appel rejette côté fetch ; le 2e doit malgré tout être émis.
    const [a, b] = await Promise.all([service.search('Echec'), service.search('Ambohipo')]);

    expect(calls.length).toBeGreaterThanOrEqual(2);
    // search() avale les erreurs réseau (best-effort) : pas de rejet propagé.
    expect(Array.isArray(a)).toBe(true);
    expect(Array.isArray(b)).toBe(true);
  }, 20000);
});
