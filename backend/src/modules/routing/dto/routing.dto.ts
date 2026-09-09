import { IsNumber, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class DirectionsRequestDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  originLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  originLng!: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  destinationLat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  destinationLng!: number;

  @IsOptional()
  @IsString()
  profile?: 'driving' | 'walking' | 'cycling';

  @IsOptional()
  alternatives?: boolean;
}

export interface RouteStep {
  distance: number;
  duration: number;
  instruction: string;
  waypoints: [number, number][];
  maneuverType?: string;
  maneuverModifier?: string;
  streetName?: string;
  exitNumber?: number;
}

export interface RouteData {
  polyline: [number, number][];
  distance: number;
  duration: number;
  steps: RouteStep[];
}

export interface DirectionsResponse {
  polyline: [number, number][];
  distance: number;
  duration: number;
  steps: RouteStep[];
  alternatives?: RouteData[];
  provider: string;
}

export class MatchRequestDto {
  coordinates!: [number, number][];
  profile?: 'driving' | 'walking' | 'cycling';
  radiuses?: number[];
  /** Délai max de l'appel OSRM (ms). Défaut 15000 (relecture) ; le suivi temps réel passe ~2000. */
  timeoutMs?: number;
}

export interface MatchResponse {
  matchedPolyline: [number, number][];
  confidence: number;
  originalPolyline: [number, number][];
  /**
   * Coordonnée [lat, lng] du DERNIER point d'entrée accrochée à la route
   * (tracepoint OSRM), ou null si ce point n'a pas pu être accroché. Utilisé par
   * le suivi temps réel pour placer le marqueur du véhicule sur la route.
   */
  snappedTail: [number, number] | null;
}
