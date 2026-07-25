/**
 * Filtre de Kalman pour lisser l'affichage GPS côté client.
 *
 * ATTENTION : Ce filtre lisse uniquement l'affichage côté client. Le backend doit toujours recevoir
 * les coordonnées GPS brutes non filtrées pour que la détection de téléportation et les alertes
 * fonctionnent sur les données réelles.
 */
export class KalmanFilter {
  private static readonly METERS_PER_DEGREE_LAT = 111320;

  private x: [number, number, number, number];
  private P: number[][];
// Acceleration noise power spectral density (deg²/s³)
  // Calibrated for ~2 m/s² RMS acceleration noise (turns, speed changes)
  private static readonly Q_A = 3.2e-10;
  private lastTs: number | null = null;

  constructor(initialLat: number, initialLng: number, accuracy = 50) {
    this.x = [initialLat, initialLng, 0, 0];

    const latStdDeg = Math.max(1, accuracy) / KalmanFilter.METERS_PER_DEGREE_LAT;
    const cosLat = Math.cos((initialLat * Math.PI) / 180);
    const lngStdDeg = latStdDeg / Math.max(0.01, cosLat);
    const vStdDeg = 10 / KalmanFilter.METERS_PER_DEGREE_LAT;
    const vLngStdDeg = vStdDeg / Math.max(0.01, cosLat);

    this.P = [
      [latStdDeg * latStdDeg, 0, 0, 0],
      [0, lngStdDeg * lngStdDeg, 0, 0],
      [0, 0, vStdDeg * vStdDeg, 0],
      [0, 0, 0, vLngStdDeg * vLngStdDeg],
    ];
  }

  private dt = 1;

  predict(timestamp?: number): { lat: number; lng: number } {
    const now = timestamp ?? Date.now();
    if (this.lastTs !== null) {
      this.dt = Math.max(0.1, (now - this.lastTs) / 1000);
    }
    this.lastTs = now;

    const dt = this.dt;
    this.x = [
      this.x[0] + this.x[2] * dt,
      this.x[1] + this.x[3] * dt,
      this.x[2],
      this.x[3],
    ];

    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];

    const FP = this.mult44(F, this.P);
    const FT = this.transpose44(F);
    this.P = this.add44(this.mult44(FP, FT), this.processNoiseMatrix(dt));

    return { lat: this.x[0], lng: this.x[1] };
  }

  update(lat: number, lng: number, accuracy: number): { lat: number; lng: number } {
    // Convert measurement noise from meters to degrees (lat/lng specific)
    const cosLat = Math.cos((this.x[0] * Math.PI) / 180);
    const metersPerDegLng = KalmanFilter.METERS_PER_DEGREE_LAT * Math.max(0.01, cosLat);
    const rLat = Math.max(1e-10, (accuracy / KalmanFilter.METERS_PER_DEGREE_LAT) ** 2);
    const rLng = Math.max(1e-10, (accuracy / metersPerDegLng) ** 2);

    const yLat = lat - this.x[0];
    const yLng = lng - this.x[1];

    // S = H * P * H^T + R  (all terms in deg²)
    const S = [
      [this.P[0][0] + rLat, this.P[0][1]],
      [this.P[1][0], this.P[1][1] + rLng],
    ];

    const detS = S[0][0] * S[1][1] - S[0][1] * S[1][0];
    if (Math.abs(detS) < 1e-20) {
      return { lat: this.x[0], lng: this.x[1] };
    }

    const invS = [
      [S[1][1] / detS, -S[0][1] / detS],
      [-S[1][0] / detS, S[0][0] / detS],
    ];

    const K = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        K[i][j] = this.P[i][0] * invS[0][j] + this.P[i][1] * invS[1][j];
      }
    }

    this.x[0] += K[0][0] * yLat + K[0][1] * yLng;
    this.x[1] += K[1][0] * yLat + K[1][1] * yLng;
    this.x[2] += K[2][0] * yLat + K[2][1] * yLng;
    this.x[3] += K[3][0] * yLat + K[3][1] * yLng;

    const I = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const KH = [
      [K[0][0], K[0][1], 0, 0],
      [K[1][0], K[1][1], 0, 0],
      [K[2][0], K[2][1], 0, 0],
      [K[3][0], K[3][1], 0, 0],
    ];
    this.P = this.mult44(this.sub44(I, KH), this.P);

    return { lat: this.x[0], lng: this.x[1] };
  }

  getVelocity(): { vLat: number; vLng: number } {
    return { vLat: this.x[2], vLng: this.x[3] };
  }

  reset(lat: number, lng: number) {
    this.x = [lat, lng, 0, 0];
    this.lastTs = null;
  }

  private processNoiseMatrix(dt: number): number[][] {
    const qa = KalmanFilter.Q_A;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    // Standard constant-velocity model: acceleration = white noise with PSD qa
    return [
      [qa * dt3 / 3, 0, qa * dt2 / 2, 0],
      [0, qa * dt3 / 3, 0, qa * dt2 / 2],
      [qa * dt2 / 2, 0, qa * dt, 0],
      [0, qa * dt2 / 2, 0, qa * dt],
    ];
  }

  private mult44(A: number[][], B: number[][]): number[][] {
    const result = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
          result[i][j] += A[i][k] * B[k][j];
        }
      }
    }
    return result;
  }

  private transpose44(M: number[][]): number[][] {
    return [
      [M[0][0], M[1][0], M[2][0], M[3][0]],
      [M[0][1], M[1][1], M[2][1], M[3][1]],
      [M[0][2], M[1][2], M[2][2], M[3][2]],
      [M[0][3], M[1][3], M[2][3], M[3][3]],
    ];
  }

  private add44(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val + B[i][j]));
  }

  private sub44(A: number[][], B: number[][]): number[][] {
    return A.map((row, i) => row.map((val, j) => val - B[i][j]));
  }

  getConfidence(): number {
    const cosLat = Math.cos((this.x[0] * Math.PI) / 180);
    const metersPerDegLng = KalmanFilter.METERS_PER_DEGREE_LAT * Math.max(0.01, cosLat);

    const varLatM2 = this.P[0][0] * KalmanFilter.METERS_PER_DEGREE_LAT ** 2;
    const varLngM2 = this.P[1][1] * metersPerDegLng ** 2;
    const estErrorM = Math.sqrt(varLatM2 + varLngM2);

    if (estErrorM < 5) return 1;
    if (estErrorM < 15) return 1 - (estErrorM - 5) / 10;
    if (estErrorM < 30) return Math.max(0.2, 1 - (estErrorM - 5) / 25);
    return Math.max(0.1, 1 - estErrorM / 60);
  }
}