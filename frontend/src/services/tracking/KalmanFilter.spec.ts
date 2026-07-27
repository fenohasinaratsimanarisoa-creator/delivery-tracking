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
});
