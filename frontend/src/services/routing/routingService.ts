import api from '../api/client';
import type { DirectionsRequest, DirectionsResponse } from './types';

export async function getDirections(req: DirectionsRequest): Promise<DirectionsResponse> {
  const res = await api.post<DirectionsResponse>('/routing/directions', req);
  return res.data;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return '<1 min';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}