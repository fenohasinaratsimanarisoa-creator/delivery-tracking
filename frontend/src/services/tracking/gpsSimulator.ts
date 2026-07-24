interface SimPoint {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  accuracy: number;
  timestamp: string;
}

function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface TraceResult {
  noisy: SimPoint[];
  clean: { lat: number; lng: number; timestamp: string }[];
}

export function generateNoisyTrace(
  waypoints: [number, number][],
  speedMs = 8.33,
  noiseStdDevM = 6,
  intervalSec = 3,
  headingOffset = 0,
): TraceResult {
  if (waypoints.length < 2) return { noisy: [], clean: [] };

  const noisy: SimPoint[] = [];
  const clean: { lat: number; lng: number; timestamp: string }[] = [];
  const segmentDistances: number[] = [];
  let totalDist = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = haversineM(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
    segmentDistances.push(d);
    totalDist += d;
  }

  const totalDurationSec = totalDist / speedMs;
  const numPoints = Math.max(2, Math.floor(totalDurationSec / intervalSec));

  let segIdx = 0;
  let segDist = 0;
  let baseLat = waypoints[0][0];
  let baseLng = waypoints[0][1];

  for (let i = 0; i < numPoints; i++) {
    if (segIdx < waypoints.length - 1) {
      const segLen = segmentDistances[segIdx];
      const frac = segLen > 0 ? Math.min(1, segDist / segLen) : 1;

      if (frac >= 1 && segIdx < waypoints.length - 2) {
        segIdx++;
        segDist = 0;
        baseLat = waypoints[segIdx][0];
        baseLng = waypoints[segIdx][1];
      }

      const nextIdx = segIdx + 1;
      const dLat = waypoints[nextIdx][0] - baseLat;
      const dLng = waypoints[nextIdx][1] - baseLng;
      const cleanLat = baseLat + dLat * frac;
      const cleanLng = baseLng + dLng * frac;
      const heading = Math.atan2(dLng, dLat) * (180 / Math.PI) + headingOffset;

      const noiseLat = gaussianRandom(0, noiseStdDevM / 111320);
      const noiseLng = gaussianRandom(0, noiseStdDevM / (111320 * Math.cos((cleanLat * Math.PI) / 180)));

      const spike = Math.random() < 0.03 ? 3 : 0;
      const spikeLat = spike * gaussianRandom(0, 5) / 111320;
      const spikeLng = spike * gaussianRandom(0, 5) / (111320 * Math.cos((cleanLat * Math.PI) / 180));

      const ts = new Date(Date.now() - (numPoints - i) * intervalSec * 1000).toISOString();

      noisy.push({
        lat: cleanLat + noiseLat + spikeLat,
        lng: cleanLng + noiseLng + spikeLng,
        speed: speedMs + gaussianRandom(0, 0.5),
        heading: heading + gaussianRandom(0, 5),
        accuracy: Math.max(3, noiseStdDevM + gaussianRandom(0, 3)),
        timestamp: ts,
      });

      clean.push({ lat: cleanLat, lng: cleanLng, timestamp: ts });

      segDist += speedMs * intervalSec;
    }
  }

  return { noisy, clean };
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateFilter(
  noisyPoints: SimPoint[],
  filterFn: (point: SimPoint, prevFiltered?: { lat: number; lng: number }) => { lat: number; lng: number },
): { rmse: number; maxError: number; errorDistances: number[] } {
  const errorDistances: number[] = [];
  let prevFiltered: { lat: number; lng: number } | undefined;

  for (const p of noisyPoints) {
    const filtered = filterFn(p, prevFiltered);
    prevFiltered = filtered;

    const error = haversineM(filtered.lat, filtered.lng, p.lat, p.lng);
    errorDistances.push(error);
  }

  const rmse = Math.sqrt(errorDistances.reduce((sum, e) => sum + e * e, 0) / errorDistances.length);
  const maxError = Math.max(...errorDistances);

  return { rmse, maxError, errorDistances };
}

export function estimateSmoothness(points: { lat: number; lng: number }[]): number {
  if (points.length < 3) return Infinity;
  let totalJerk = 0;
  let count = 0;
  for (let i = 2; i < points.length; i++) {
    const d1 = haversineM(points[i - 2].lat, points[i - 2].lng, points[i - 1].lat, points[i - 1].lng);
    const d2 = haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    totalJerk += Math.abs(d2 - d1);
    count++;
  }
  return count > 0 ? totalJerk / count : Infinity;
}