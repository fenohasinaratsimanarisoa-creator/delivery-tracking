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
    service = new GeocodingService(
      mockRedis as any,
      mockConfigService as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('placesAutocomplete', () => {
    it('returns cached results when available', async () => {
      const cached = [{ placeId: 'abc', description: 'Test', mainText: 'Test', secondaryText: 'MG' }];
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
      mockFetchOnce({
        location: { latitude: -18.91, longitude: 47.52 },
        formattedAddress: 'Antananarivo, Madagascar',
        displayName: { text: 'Antananarivo' },
      }, true);

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
      mockFetchOnce([
        {
          lat: '-18.91',
          lon: '47.52',
          display_name: 'Antananarivo, Madagascar',
          name: 'Antananarivo',
          address: { city: 'Antananarivo', country: 'Madagascar' },
        },
      ], true);

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
