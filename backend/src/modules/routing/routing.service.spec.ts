import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RoutingService } from './routing.service';
import { MatchRequestDto } from './dto/routing.dto';

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
      geometry: {
        coordinates: [
          [47.52, -18.91],
          [47.53, -18.87],
        ],
      },
      distance: 5000,
      duration: 300,
      legs: [{ steps: [] }],
    };

    it('returns directions from local OSRM', async () => {
      mockFetchOnce(
        {
          code: 'Ok',
          routes: [osrmRoute],
        },
        true,
      );

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
      mockFetchOnce(
        {
          code: 'Ok',
          routes: [osrmRoute, { ...osrmRoute, distance: 6000, duration: 400 }],
        },
        true,
      );

      const result = await service.getDirections({ ...dto, alternatives: true });

      expect(result.alternatives).toBeDefined();
      expect(result.alternatives).toHaveLength(1);
    });
  });

  describe('matchToRoad', () => {
    const dto = {
      coordinates: [
        [-18.91, 47.52],
        [-18.87, 47.53],
      ] as [number, number][],
    };

    it('returns matched polyline from OSRM', async () => {
      mockFetchOnce(
        {
          code: 'Ok',
          matchings: [
            {
              confidence: 0.95,
              geometry: {
                coordinates: [
                  [47.52, -18.91],
                  [47.53, -18.87],
                ],
              },
              distance: 5000,
              duration: 300,
            },
          ],
          tracepoints: [{ location: [47.52, -18.91], waypoint_index: 0 }],
        },
        true,
      );

      const result = await service.matchToRoad(dto);

      expect(result.confidence).toBe(0.95);
      expect(result.matchedPolyline).toBeDefined();
      expect(result.originalPolyline).toBeDefined();
      // snappedTail = dernier tracepoint non-null, converti [lng,lat] → [lat,lng].
      expect(result.snappedTail).toEqual([-18.91, 47.52]);
    });

    it("snappedTail = null si le DERNIER fix (courant) n'a pas pu être accroché", async () => {
      mockFetchOnce(
        {
          code: 'Ok',
          matchings: [
            {
              confidence: 0.9,
              geometry: { coordinates: [[47.52, -18.91]] },
              distance: 1,
              duration: 1,
            },
          ],
          // Le dernier point d'entrée est un aberrant (null) — on ne veut PAS
          // accrocher un fix plus ancien à sa place.
          tracepoints: [{ location: [47.52, -18.91], waypoint_index: 0 }, null],
        },
        true,
      );

      const result = await service.matchToRoad(dto);
      expect(result.snappedTail).toBeNull();
    });

    // BUG 2026-09-09 : MatchRequestDto sans décorateurs → le ValidationPipe global
    // (whitelist) rejetait tout le corps (« property coordinates should not exist »).
    describe('MatchRequestDto — validation (ValidationPipe whitelist)', () => {
      it('accepte un corps { coordinates, radiuses } valide', async () => {
        const inst = plainToInstance(MatchRequestDto, {
          coordinates: [
            [-18.91, 47.52],
            [-18.87, 47.53],
          ],
          radiuses: [25, 25],
        });
        expect(await validate(inst, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(
          0,
        );
      });

      it('rejette coordinates absent / trop court', async () => {
        expect(
          await validate(plainToInstance(MatchRequestDto, {}), { whitelist: true }),
        ).not.toHaveLength(0);
        expect(
          await validate(plainToInstance(MatchRequestDto, { coordinates: [[-18.9, 47.5]] }), {
            whitelist: true,
          }),
        ).not.toHaveLength(0);
      });

      it('rejette un profile inconnu', async () => {
        expect(
          await validate(
            plainToInstance(MatchRequestDto, {
              coordinates: [
                [-18.9, 47.5],
                [-18.8, 47.6],
              ],
              profile: 'flying',
            }),
            { whitelist: true },
          ),
        ).not.toHaveLength(0);
      });
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

  describe('optimizeTrip', () => {
    const dto = {
      // 3 points fournis dans le désordre — OSRM (mocké) renvoie l'ordre optimal.
      coordinates: [
        [-18.91, 47.52],
        [-18.95, 47.55],
        [-18.87, 47.53],
      ] as [number, number][],
    };

    const osrmTripResponse = {
      code: 'Ok',
      waypoints: [
        { waypoint_index: 2 }, // point d'entrée 0 → 3e de la tournée
        { waypoint_index: 0 }, // point d'entrée 1 → 1er de la tournée
        { waypoint_index: 1 }, // point d'entrée 2 → 2e de la tournée
      ],
      trips: [
        {
          geometry: { coordinates: [[47.55, -18.95], [47.53, -18.87], [47.52, -18.91]] },
          distance: 8000,
          duration: 600,
        },
      ],
    };

    it("reconstruit l'ordre optimal (indices d'entrée) depuis waypoint_index d'OSRM", async () => {
      mockFetchOnce(osrmTripResponse);

      const result = await service.optimizeTrip(dto);

      // waypoint_index triés : entrée 1 (pos 0) → entrée 2 (pos 1) → entrée 0 (pos 2)
      expect(result.order).toEqual([1, 2, 0]);
      expect(result.distance).toBe(8000);
      expect(result.duration).toBe(600);
      expect(result.provider).toBe('osrm');
      expect(result.polyline[0]).toEqual([-18.95, 47.55]);
    });

    it('appelle le service /trip/ OSRM local avec roundtrip=false&source=first&destination=any', async () => {
      // source=first est OBLIGATOIRE : OSRM renvoie 400 "NotImplemented" pour
      // source=any&destination=any en roundtrip=false (vérifié en prod,
      // 2026-09-18) — un TSP ouvert sans AUCUNE extrémité fixée n'est pas un
      // problème qu'OSRM résout. Ne pas revenir à source=any sans avoir
      // retesté contre une vraie instance osrm-routed.
      mockFetchOnce(osrmTripResponse);

      await service.optimizeTrip(dto);

      const url = (global.fetch as jest.Mock).mock.calls[0][0] as string;
      expect(url).toContain('localhost:5000/trip/v1/driving/');
      expect(url).toContain('roundtrip=false');
      expect(url).toContain('source=first');
      expect(url).toContain('destination=any');
      expect(url).not.toContain('project-osrm.org');
    });

    it('renvoie 422 (pas de fallback) quand OSRM ne trouve aucune tournée', async () => {
      mockFetchOnce({ code: 'NoRoute', waypoints: [], trips: [] });

      await expect(service.optimizeTrip(dto)).rejects.toMatchObject({ status: 422 });
    });

    it('renvoie 503 sur une vraie panne OSRM (pas un 422)', async () => {
      mockFetchOnce(null, false);

      await expect(service.optimizeTrip(dto)).rejects.toMatchObject({ status: 503 });
    });
  });
});
