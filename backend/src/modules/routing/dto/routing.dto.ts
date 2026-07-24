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
}

export interface MatchResponse {
  matchedPolyline: [number, number][];
  confidence: number;
  originalPolyline: [number, number][];
}
