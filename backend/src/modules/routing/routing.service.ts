import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DirectionsRequestDto, DirectionsResponse, RouteStep, MatchRequestDto, MatchResponse } from './dto/routing.dto';

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly osrmBaseUrl: string;
  private readonly osrmPublicUrl = 'https://router.project-osrm.org';
  private readonly googleApiKey: string | undefined;

  constructor(private configService: ConfigService) {
    this.osrmBaseUrl =
      this.configService.get<string>('OSRM_BASE_URL') || 'http://localhost:5000';
    this.googleApiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
  }

  async getDirections(dto: DirectionsRequestDto): Promise<DirectionsResponse> {
    // Try local OSRM first
    try {
      return await this.getOsrmDirections(dto, this.osrmBaseUrl);
    } catch (localErr) {
      this.logger.warn(`Local OSRM failed: ${(localErr as Error).message}`);
    }

    // Try public OSRM demo server
    try {
      this.logger.log('Trying public OSRM demo server');
      return await this.getOsrmDirections(dto, this.osrmPublicUrl);
    } catch (publicErr) {
      this.logger.warn(`Public OSRM failed: ${(publicErr as Error).message}`);
    }

    // Fallback to Google Directions
    if (this.googleApiKey) {
      try {
        this.logger.log('Trying Google Directions API');
        return await this.getGoogleDirections(dto);
      } catch (googleErr) {
        this.logger.error(`Google Directions also failed: ${(googleErr as Error).message}`);
        throw new HttpException(
          'Routing unavailable',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
    }

    throw new HttpException(
      'All routing providers failed',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private extractRouteData(route: {
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
    legs: Array<{
      steps: Array<{
        distance: number;
        duration: number;
        name: string;
        maneuver: {
          instruction?: string;
          type?: string;
          modifier?: string;
          exit?: number;
        };
        geometry: { coordinates: [number, number][] };
      }>;
    }>;
  }) {
    const polyline: [number, number][] = route.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );
    const steps: RouteStep[] = [];
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        const stepWaypoints: [number, number][] = step.geometry.coordinates.map(
          (c) => [c[1], c[0]] as [number, number],
        );
        steps.push({
          distance: step.distance,
          duration: step.duration,
          instruction: step.maneuver?.instruction || '',
          waypoints: stepWaypoints,
          maneuverType: step.maneuver?.type,
          maneuverModifier: step.maneuver?.modifier,
          streetName: step.name,
        });
      }
    }
    return { polyline, distance: route.distance, duration: route.duration, steps };
  }

  private async getOsrmDirections(
    dto: DirectionsRequestDto,
    baseUrl: string,
  ): Promise<DirectionsResponse> {
    const profile = dto.profile || 'driving';
    const alternativesParam = dto.alternatives ? '&alternatives=3' : '';
    const url = `${baseUrl}/route/v1/${profile}/${dto.originLng},${dto.originLat};${dto.destinationLng},${dto.destinationLat}?overview=full&geometries=geojson&steps=true${alternativesParam}`;

    this.logger.debug(`OSRM request: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`OSRM HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      code: string;
      routes: Array<{
        geometry: { coordinates: [number, number][] };
        distance: number;
        duration: number;
        legs: Array<{
          steps: Array<{
            distance: number;
            duration: number;
            name: string;
            maneuver: {
              instruction?: string;
              type?: string;
              modifier?: string;
              exit?: number;
            };
            geometry: { coordinates: [number, number][] };
          }>;
        }>;
      }>;
    };

    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(`OSRM no route found: ${data.code}`);
    }

    const main = this.extractRouteData(data.routes[0]);
    const alternatives: { polyline: [number, number][]; distance: number; duration: number; steps: RouteStep[] }[] = [];
    if (dto.alternatives && data.routes.length > 1) {
      for (let i = 1; i < data.routes.length; i++) {
        alternatives.push(this.extractRouteData(data.routes[i]));
      }
    }

    return {
      polyline: main.polyline,
      distance: main.distance,
      duration: main.duration,
      steps: main.steps,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      provider: 'osrm',
    };
  }

  private async getGoogleDirections(
    dto: DirectionsRequestDto,
  ): Promise<DirectionsResponse> {
    const origin = `${dto.originLat},${dto.originLng}`;
    const destination = `${dto.destinationLat},${dto.destinationLng}`;
    const mode = dto.profile === 'walking' ? 'walking' : 'driving';
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=${mode}&units=metric&key=${this.googleApiKey}`;

    this.logger.debug(`Google Directions request`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Google Directions HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      status: string;
      routes: Array<{
        legs: Array<{
          distance: { value: number };
          duration: { value: number };
          steps: Array<{
            distance: { value: number };
            duration: { value: number };
            html_instructions: string;
            maneuver?: string;
            polyline: { points: string };
          }>;
        }>;
        overview_polyline: { points: string };
      }>;
    };

    if (data.status !== 'OK' || !data.routes?.length) {
      throw new Error(`Google Directions no route: ${data.status}`);
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    const polyline = this.decodePolyline(route.overview_polyline.points);

    const steps: RouteStep[] = [];
    for (const step of leg.steps) {
      const stepPoints = this.decodePolyline(step.polyline.points);
      const instruction = step.html_instructions?.replace(/<[^>]*>/g, '') || '';
      steps.push({
        distance: step.distance.value,
        duration: step.duration.value,
        instruction,
        waypoints: stepPoints,
        maneuverType: step.maneuver,
        streetName: instruction.split(' sur ')[1]?.split(',')[0]?.trim(),
      });
    }

    return {
      polyline,
      distance: leg.distance.value,
      duration: leg.duration.value,
      steps,
      provider: 'google',
    };
  }

  async matchToRoad(dto: MatchRequestDto): Promise<MatchResponse> {
    const coords = dto.coordinates.map((c) => `${c[1]},${c[0]}`).join(';');
    const radiuses = dto.radiuses?.join(';') || '';
    const profile = dto.profile || 'driving';

    const tryMatch = async (baseUrl: string): Promise<MatchResponse> => {
      let url = `${baseUrl}/match/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
      if (radiuses) url += `&radiuses=${radiuses}`;

      this.logger.debug(`OSRM match request: ${url}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`OSRM match HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as {
        code: string;
        matchings: Array<{
          confidence: number;
          geometry: { coordinates: [number, number][] };
          distance: number;
          duration: number;
        }>;
        tracepoints: Array<{
          location: [number, number];
          waypoint_index: number;
        } | null>;
      };

      if (data.code !== 'Ok' || !data.matchings?.length) {
        throw new Error(`OSRM match failed: ${data.code}`);
      }

      const best = data.matchings[0];
      const matchedPolyline: [number, number][] = best.geometry.coordinates.map(
        (c) => [c[1], c[0]] as [number, number],
      );

      return {
        matchedPolyline,
        confidence: best.confidence,
        originalPolyline: dto.coordinates.map(
          (c) => [c[0], c[1]] as [number, number],
        ),
      };
    };

    let lastError: Error | null = null;

    try {
      return await tryMatch(this.osrmBaseUrl);
    } catch (err) {
      lastError = err as Error;
      this.logger.warn(`Local OSRM match failed: ${lastError.message}`);
    }

    try {
      return await tryMatch(this.osrmPublicUrl);
    } catch (err) {
      lastError = err as Error;
      this.logger.warn(`Public OSRM match also failed: ${lastError.message}`);
    }

    // Fallback: return original trace with 0 confidence (no matching available)
    this.logger.warn('Map matching unavailable — returning original trace');
    return {
      matchedPolyline: dto.coordinates.map((c) => [c[0], c[1]] as [number, number]),
      confidence: 0,
      originalPolyline: dto.coordinates.map((c) => [c[0], c[1]] as [number, number]),
    };
  }

  private decodePolyline(encoded: string): [number, number][] {
    const points: [number, number][] = [];
    let index = 0;
    const len = encoded.length;
    let lat = 0;
    let lng = 0;

    while (index < len) {
      let b: number;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push([lat / 1e5, lng / 1e5]);
    }

    return points;
  }
}