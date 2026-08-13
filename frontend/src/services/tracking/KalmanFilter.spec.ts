import { describe, it, expect } from 'vitest';
import { KalmanFilter } from './KalmanFilter';

describe('KalmanFilter', () => {
  it('initializes with given coordinates', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 10);
    const result = kf.predict();
    expect(result.lat).toBeCloseTo(-18.8792, 4);
    expect(result.lng).toBeCloseTo(47.5079, 4);
    expect(kf.getConfidence()).toBeGreaterThanOrEqual(0);
  });

  it('converges on a stationary simulated trajectory', () => {
    const lat = -18.8792;
    const lng = 47.5079;
    const kf = new KalmanFilter(lat, lng, 10);

    for (let i = 0; i < 30; i++) {
      kf.predict();
      kf.update(lat + (Math.random() - 0.5) * 0.0001, lng + (Math.random() - 0.5) * 0.0001, 10);
    }

    const state = kf.predict();
    const confidence = kf.getConfidence();

    expect(Math.abs(state.lat - lat)).toBeLessThan(0.0002);
    expect(Math.abs(state.lng - lng)).toBeLessThan(0.0002);
    expect(confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('converges on a moving trajectory', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 10);

    for (let i = 0; i < 30; i++) {
      const trueLat = -18.8792 + i * 0.0005;
      const trueLng = 47.5079 + i * 0.0005;
      kf.predict();
      kf.update(
        trueLat + (Math.random() - 0.5) * 0.0002,
        trueLng + (Math.random() - 0.5) * 0.0002,
        10,
      );
    }

    const state = kf.predict();
    const expectedLat = -18.8792 + 29 * 0.0005;
    const expectedLng = 47.5079 + 29 * 0.0005;

    expect(Math.abs(state.lat - expectedLat)).toBeLessThan(0.0005);
    expect(Math.abs(state.lng - expectedLng)).toBeLessThan(0.0005);
  });

  it('maintains reasonable output with very poor accuracy (>80m)', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 80);

    for (let i = 0; i < 10; i++) {
      kf.predict();
      kf.update(
        -18.8792 + (Math.random() - 0.5) * 0.005,
        47.5079 + (Math.random() - 0.5) * 0.005,
        80 + Math.random() * 40,
      );
    }

    const state = kf.predict();
    const confidence = kf.getConfidence();

    expect(state.lat).toBeDefined();
    expect(state.lng).toBeDefined();
    expect(confidence).toBeLessThanOrEqual(0.5);
    expect(confidence).toBeGreaterThanOrEqual(0.1);
  });

  it('returns filtered value within expected bounds when accuracy is very poor', () => {
    const baseLat = -18.8792;
    const baseLng = 47.5079;
    const kf = new KalmanFilter(baseLat, baseLng, 100);

    for (let i = 0; i < 5; i++) {
      kf.predict();
      const result = kf.update(
        baseLat + (Math.random() - 0.5) * 0.01,
        baseLng + (Math.random() - 0.5) * 0.01,
        100,
      );
      expect(Math.abs(result.lat - baseLat)).toBeLessThan(0.01);
      expect(Math.abs(result.lng - baseLng)).toBeLessThan(0.01);
    }
  });

  it('velocity estimation improves with more observations', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 10);

    const vLat = 0.0001;
    const vLng = 0.0001;

    for (let i = 0; i < 20; i++) {
      const trueLat = -18.8792 + i * vLat;
      const trueLng = 47.5079 + i * vLng;
      kf.predict();
      kf.update(trueLat, trueLng, 10);
    }

    const vel = kf.getVelocity();
    expect(vel.vLat).toBeGreaterThan(0);
    expect(vel.vLng).toBeGreaterThan(0);
  });

  it('handles reset correctly', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 10);
    kf.predict();
    kf.update(-18.8800, 47.5085, 10);
    kf.reset(-18.9000, 47.5200);

    const result = kf.predict();
    expect(result.lat).toBe(-18.9000);
    expect(result.lng).toBe(47.5200);
  });

  it('getConfidence returns 1.0 for very accurate initial state', () => {
    const kf = new KalmanFilter(-18.8792, 47.5079, 1);
    expect(kf.getConfidence()).toBe(1.0);
  });

  // ----------------------------------------------------------------
  // Bug : double predict() avant le premier update() (processCoords)
  // ----------------------------------------------------------------
  describe('predict() unique avant le premier update()', () => {
    const M = 111320;
    const LAT = -18.8792;
    const LNG = 47.5079;

    // Modèle constant-velocity à UN SEUL predict (dt=1) puis update :
    // P₁ = F·P₀·Fᵀ + Q(dt=1), P₂ = (I - K·H)·P₁, résolu analytiquement.
    function expectedAfterFirstFix(acc: number) {
      const cosLat = Math.max(0.01, Math.cos((LAT * Math.PI) / 180));
      const mLng = M * cosLat;
      const a = Math.max(1, acc) / M;
      const b = a / cosLat;
      const c = 10 / M;
      const d = c / cosLat;
      const qa = 3.2e-10;

      const P100 = a * a + c * c + qa / 3;
      const P111 = b * b + d * d + qa / 3;
      const P102 = c * c + qa / 2;
      const P113 = d * d + qa / 2;
      const P122 = c * c + qa;
      const P133 = d * d + qa;

      const rLat = Math.max(1e-10, (acc / M) ** 2);
      const rLng = Math.max(1e-10, (acc / mLng) ** 2);

      const P200 = (P100 * rLat) / (P100 + rLat);
      const P211 = (P111 * rLng) / (P111 + rLng);
      const P202 = (P102 * rLat) / (P100 + rLat);
      const P213 = (P113 * rLng) / (P111 + rLng);
      const P222 = P122 - P102 ** 2 / (P100 + rLat);
      const P233 = P133 - P113 ** 2 / (P111 + rLng);

      const P = [
        [P200, 0, P202, 0],
        [0, P211, 0, P213],
        [P202, 0, P222, 0],
        [0, P213, 0, P233],
      ];

      const estErrorM = Math.sqrt(P200 * M ** 2 + P211 * mLng ** 2);
      const confidence =
        estErrorM < 5
          ? 1
          : estErrorM < 15
            ? 1 - (estErrorM - 5) / 10
            : estErrorM < 30
              ? Math.max(0.2, 1 - (estErrorM - 5) / 25)
              : Math.max(0.1, 1 - estErrorM / 60);
      return { P, estErrorM, confidence };
    }

    it('premier fix : covariance P et getConfidence() cohérentes avec le modèle à UN SEUL predict (dt=1)', () => {
      const acc = 10;
      const expected = expectedAfterFirstFix(acc);

      const kf = new KalmanFilter(LAT, LNG, acc);
      kf.predict(1000); // 1 seul predict (dt=1, première initialisation)
      kf.update(LAT, LNG, acc); // premier fix

      const P = (kf as any).P as number[][];
      // Tolérance machine-safe (1e-12) : la dégradation du double predict
      // (~1.8e-10 sur P[0][0]) dépasse largement cette borne → le test échoue
      // si le predict() en trop est réintroduit.
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          expect(Math.abs(P[i][j] - expected.P[i][j])).toBeLessThan(1e-12);
        }
      }
      // Tolérance demandée 1e-6 sur la confidence.
      expect(Math.abs(kf.getConfidence() - expected.confidence)).toBeLessThan(1e-6);

      console.log(
        `[kalman] 1 fix acc=${acc}m → P[0][0]=${P[0][0].toExponential(4)} (attendu ${expected.P[0][0].toExponential(4)}), ` +
          `P[1][1]=${P[1][1].toExponential(4)} (attendu ${expected.P[1][1].toExponential(4)}), ` +
          `estError=${expected.estErrorM.toFixed(3)}m, confidence=${kf.getConfidence().toFixed(6)} (attendu ${expected.confidence.toFixed(6)})`,
      );
    });

    it('détecte le predict() en trop : covariance du double predict > modèle analytique', () => {
      const acc = 10;
      const expected = expectedAfterFirstFix(acc);

      const single = new KalmanFilter(LAT, LNG, acc);
      single.predict(1000); // flux corrigé
      single.update(LAT, LNG, acc);

      const doubled = new KalmanFilter(LAT, LNG, acc);
      doubled.predict(1000);
      doubled.predict(1001); // predict() EN TROP (dt → max(0.1, 1ms) = 0.1)
      doubled.update(LAT, LNG, acc);

      const P1 = (single as any).P as number[][];
      const P2 = (doubled as any).P as number[][];
      const c1 = single.getConfidence();
      const c2 = doubled.getConfidence();

      console.log(
        `[kalman] double-predict: P[0][0]=${P2[0][0].toExponential(4)} vs modèle à 1 predict=${expected.P[0][0].toExponential(4)} ` +
          `(flux corrigé=${P1[0][0].toExponential(4)}) → confidence ${c2.toFixed(6)} vs ${c1.toFixed(6)}`,
      );

      // Le chemin corrigé colle au modèle analytique ; le double predict gonfle P.
      expect(Math.abs(P1[0][0] - expected.P[0][0])).toBeLessThan(1e-12);
      expect(P2[0][0]).toBeGreaterThan(expected.P[0][0]);
      expect(c1).toBeGreaterThanOrEqual(c2);
    });

    it('non-régression : deux fixes successifs proches → confidence proche de 1', () => {
      const acc = 5;
      const kf = new KalmanFilter(LAT, LNG, acc);
      kf.predict(0); // init → 1 predict (dt=1)
      kf.update(LAT, LNG, acc); // fix 1
      kf.predict(100); // fix 2 → 1 predict (dt=0.1)
      kf.update(LAT + 1e-6, LNG + 1e-6, acc); // positions quasi identiques

      const confidence = kf.getConfidence();
      const P = (kf as any).P as number[][];
      const cosLat = Math.max(0.01, Math.cos((LAT * Math.PI) / 180));
      const estErrorM = Math.sqrt(P[0][0] * M ** 2 + P[1][1] * (M * cosLat) ** 2);

      console.log(
        `[kalman] 2 fixes proches acc=${acc}m → estError=${estErrorM.toFixed(3)}m → confidence=${confidence.toFixed(6)} (≥0.99 attendu)`,
      );

      // Non dégradée par un predict() en trop : sous le seuil de confiance 1.
      expect(estErrorM).toBeLessThan(5);
      expect(confidence).toBeGreaterThan(0.99);
    });
  });
});
