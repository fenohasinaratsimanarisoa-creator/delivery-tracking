import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { RoutingService } from './routing.service';

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'OSRM_BASE_URL') return 'http://localhost:5000';
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

describe('RoutingService', () => {
  let service: RoutingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RoutingService(mockConfigService as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDirections', () => {
    const dto = {
      originLat: -18.91,
      originLng: 47.52,
      destinationLat: -18.87,
      destinationLng: 47.53,
    };

    const osrmRoute = {
      geometry: { coordinates: [[47.52, -18.91], [47.53, -18.87]] },
      distance: 5000,
      duration: 300,
      legs: [{ steps: [] }],
    };

    it('returns directions from local OSRM', async () => {
      mockFetchOnce({
        code: 'Ok',
        routes: [osrmRoute],
      }, true);

      const result = await service.getDirections(dto);

      expect(result.provider).toBe('osrm');
      expect(result.distance).toBe(5000);
      expect(result.duration).toBe(300);
    });

    it('falls back to public OSRM when local fails', async () => {
      mockFetchOnce(null, false);
      mockFetchOnce({
        code: 'Ok',
        routes: [osrmRoute],
      }, true);

      const result = await service.getDirections(dto);

      expect(result.provider).toBe('osrm');
      expect(result.distance).toBe(5000);
    });

    it('falls back to Google Directions when both OSRM servers fail', async () => {
      mockFetchOnce(null, false);
      mockFetchOnce(null, false);
      mockFetchOnce({
        status: 'OK',
        routes: [{
          legs: [{
            distance: { value: 5200 },
            duration: { value: 310 },
            steps: [],
          }],
          overview_polyline: { points: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
        }],
      }, true);

      const result = await service.getDirections(dto);

      expect(result.provider).toBe('google');
      expect(result.distance).toBe(5200);
      expect(result.duration).toBe(310);
    });

    it('throws when all providers fail and no Google key', async () => {
      const noKeyService = new RoutingService(
        { get: jest.fn((key: string) => key === 'OSRM_BASE_URL' ? 'http://localhost:5000' : undefined) } as unknown as ConfigService,
      );

      mockFetchOnce(null, false);
      mockFetchOnce(null, false);

      await expect(noKeyService.getDirections(dto)).rejects.toThrow(HttpException);
    });

    it('includes alternatives when requested', async () => {
      mockFetchOnce({
        code: 'Ok',
        routes: [osrmRoute, { ...osrmRoute, distance: 6000, duration: 400 }],
      }, true);

      const result = await service.getDirections({ ...dto, alternatives: true });

      expect(result.alternatives).toBeDefined();
      expect(result.alternatives).toHaveLength(1);
    });
  });

  describe('matchToRoad', () => {
    const dto = {
      coordinates: [[-18.91, 47.52], [-18.87, 47.53]] as [number, number][],
    };

    it('returns matched polyline from OSRM', async () => {
      mockFetchOnce({
        code: 'Ok',
        matchings: [{
          confidence: 0.95,
          geometry: { coordinates: [[47.52, -18.91], [47.53, -18.87]] },
          distance: 5000,
          duration: 300,
        }],
        tracepoints: [{ location: [47.52, -18.91], waypoint_index: 0 }],
      }, true);

      const result = await service.matchToRoad(dto);

      expect(result.confidence).toBe(0.95);
      expect(result.matchedPolyline).toBeDefined();
      expect(result.originalPolyline).toBeDefined();
    });

    it('returns original trace with 0 confidence when OSRM fails', async () => {
      mockFetchOnce(null, false);
      mockFetchOnce(null, false);

      const result = await service.matchToRoad(dto);

      expect(result.confidence).toBe(0);
      expect(result.matchedPolyline).toEqual(
        expect.arrayContaining([[expect.any(Number), expect.any(Number)]]),
      );
    });
  });
});
