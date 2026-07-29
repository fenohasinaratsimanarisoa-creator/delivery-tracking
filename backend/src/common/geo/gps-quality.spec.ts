import { computeConfidence, computeCombinedAccuracy } from './gps-quality';

describe('computeCombinedAccuracy', () => {
  it('should use device accuracy when no HDOP', () => {
    const result = computeCombinedAccuracy(10, undefined);
    expect(result.accuracy).toBe(10);
  });

  it('should fallback to 50 when device accuracy is 0 and no HDOP', () => {
    const result = computeCombinedAccuracy(0, undefined);
    expect(result.accuracy).toBe(50);
  });

  it('should fallback to 50 when no accuracy and no HDOP', () => {
    const result = computeCombinedAccuracy(undefined, undefined);
    expect(result.accuracy).toBe(50);
  });

  it('should keep device accuracy when HDOP gives better (lower) accuracy', () => {
    const result = computeCombinedAccuracy(10, { hdop: 1 });
    expect(result.accuracy).toBe(10);
    expect(result.hdopInfo).toContain('device plus precis');
  });

  it('should use HDOP when it gives worse (higher) accuracy', () => {
    const result = computeCombinedAccuracy(10, { hdop: 8 });
    expect(result.accuracy).toBe(40);
    expect(result.hdopInfo).toContain('retenu');
  });

  it('should handle hdop=1.2: accuracy=6m, keep device=10m (device more precise)', () => {
    const result = computeCombinedAccuracy(10, { hdop: 1.2 });
    expect(result.accuracy).toBe(10);
  });

  it('should handle hdop=8: accuracy=40m, use HDOP value', () => {
    const result = computeCombinedAccuracy(10, { hdop: 8 });
    expect(result.accuracy).toBe(40);
  });

  it('should handle NaN HDOP gracefully', () => {
    const result = computeCombinedAccuracy(10, { hdop: 'invalid' });
    expect(result.accuracy).toBe(10);
  });

  it('should handle negative HDOP gracefully', () => {
    const result = computeCombinedAccuracy(10, { hdop: -1 });
    expect(result.accuracy).toBe(10);
  });
});

describe('computeConfidence', () => {
  it('should return 100 for perfect conditions', () => {
    expect(computeConfidence(3, false)).toBe(95);
  });

  it('should deduct for poor accuracy', () => {
    expect(computeConfidence(60, false)).toBe(40);
  });

  it('should deduct heavily for suspect', () => {
    expect(computeConfidence(10, true)).toBe(40);
  });

  it('should clamp to 0 minimum', () => {
    expect(computeConfidence(200, true)).toBe(0);
  });

  it('should cap static positions at 70', () => {
    expect(computeConfidence(5, false, 0.01)).toBe(70);
  });

  it('should return 70 for unknown accuracy', () => {
    expect(computeConfidence(undefined, false)).toBe(70);
  });
});
