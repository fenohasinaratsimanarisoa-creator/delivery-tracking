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

export interface DirectionsRequest {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  profile?: 'driving' | 'walking' | 'cycling';
  alternatives?: boolean;
}