import { ConfigService } from '@nestjs/config';
import { RoutingService } from './routing.service';

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'OSRM_BASE_URL') return 'http://localhost:5000';
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

    it('throws 422 on OSRM NoRoute without calling the public OSRM demo server', async () => {
      mockFetchOnce({ code: 'NoRoute', routes: [] }, true);

      await expect(service.getDirections(dto)).rejects.toMatchObject({
        status: 422,
        response: 'Aucun itinéraire trouvé pour ces coordonnées',
      });

      // Un seul appel réseau, vers l'OSRM local uniquement.
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('localhost:5000');
      expect(url).not.toContain('project-osrm.org');
      expect(url).not.toContain('googleapis.com');
    });

    it('throws 503 on local OSRM network failure without any external fallback', async () => {
      mockFetchOnce(null, false);

      await expect(service.getDirections(dto)).rejects.toMatchObject({ status: 503 });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('localhost:5000');
      expect(url).not.toContain('project-osrm.org');
      expect(url).not.toContain('googleapis.com');
    });

    it('throws 422 on OSRM InvalidQuery without any fallback', async () => {
      mockFetchOnce({ code: 'InvalidQuery', routes: [] }, true);

      await expect(service.getDirections(dto)).rejects.toMatchObject({ status: 422 });
      expect(global.fetch).toHaveBeenCalledTimes(1);
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

    it('returns original trace with 0 confidence on local OSRM failure (no external call)', async () => {
      mockFetchOnce(null, false);

      const result = await service.matchToRoad(dto);

      expect(result.confidence).toBe(0);
      expect(result.matchedPolyline).toEqual(
        expect.arrayContaining([[expect.any(Number), expect.any(Number)]]),
      );

      // Un seul appel réseau, vers l'OSRM local uniquement (aucun fallback public).
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('localhost:5000');
      expect(url).not.toContain('project-osrm.org');
    });
  });
});
