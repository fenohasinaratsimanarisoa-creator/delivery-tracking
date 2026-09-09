import { computeConfidence, computeCombinedAccuracy, accuracyFromSatellites } from './gps-quality';

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

  // AUDIT PRÉCISION GPS PHYSIQUE 2026-09-09 — accuracy dérivée du nombre de satellites
  // (GT06 qui ne remonte NI accuracy NI hdop, seulement `sat`).
  it('sat=15, aucune autre source → accuracy = 8 m (au lieu du défaut 50)', () => {
    const r = computeCombinedAccuracy(0, { sat: 15 });
    expect(r.accuracy).toBe(8);
    expect(r.hdopInfo).toContain('sat=15');
  });

  it('sat=7 (fix faible) → accuracy = 35 m', () => {
    expect(computeCombinedAccuracy(0, { sat: 7 }).accuracy).toBe(35);
  });

  it('sat=4 → accuracy = 150 m (fix à peine exploitable)', () => {
    expect(computeCombinedAccuracy(undefined, { sat: 4 }).accuracy).toBe(150);
  });

  it('sat combiné en max() : device 10 m plus précis que sat 7 (35 m) → 35 m retenu', () => {
    // le plus PRUDENT (le plus grand) l'emporte
    expect(computeCombinedAccuracy(10, { sat: 7 }).accuracy).toBe(35);
    // device 40 m pire que sat 15 (8 m) → device retenu
    expect(computeCombinedAccuracy(40, { sat: 15 }).accuracy).toBe(40);
  });

  it('hdop ET sat présents → max des deux avec le device', () => {
    // hdop 2 → 10 m, sat 7 → 35 m, device unset → 35 m
    expect(computeCombinedAccuracy(undefined, { hdop: 2, sat: 7 }).accuracy).toBe(35);
  });

  it('sans sat exploitable → comportement inchangé (défaut 50)', () => {
    expect(computeCombinedAccuracy(0, { sat: 0 }).accuracy).toBe(50);
    expect(computeCombinedAccuracy(0, { motion: false }).accuracy).toBe(50);
  });
});

describe('accuracyFromSatellites', () => {
  it('barème calibré, monotone décroissant avec le nombre de satellites', () => {
    expect(accuracyFromSatellites(15)).toBe(8);
    expect(accuracyFromSatellites(12)).toBe(8);
    expect(accuracyFromSatellites(11)).toBe(12);
    expect(accuracyFromSatellites(9)).toBe(20);
    expect(accuracyFromSatellites(7)).toBe(35);
    expect(accuracyFromSatellites(6)).toBe(55);
    expect(accuracyFromSatellites(5)).toBe(90);
    expect(accuracyFromSatellites(3)).toBe(150);
  });

  it('valeur absente / aberrante → null', () => {
    expect(accuracyFromSatellites(undefined)).toBeNull();
    expect(accuracyFromSatellites(0)).toBeNull();
    expect(accuracyFromSatellites(-2)).toBeNull();
    expect(accuracyFromSatellites('n/a')).toBeNull();
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
