import { describe, it, expect } from 'vitest';
import {
  isBackwardJitter,
  deadReckonHorizonMs,
  MAX_DEAD_RECKON_DISTANCE_M,
  MAX_BACKWARD_HOLD_M,
} from './markerMotion';

const M = 1 / 111_320; // degrés de latitude par mètre
const at = (northM: number, eastM = 0) => ({ lat: -18.87 + northM * M, lng: 47.554 + eastM * M });

describe('isBackwardJitter — le marqueur ne recule jamais au sens de marche', () => {
  // Véhicule qui monte vers le nord : deux derniers fixes réels à 0 m puis 10 m.
  const prev = at(0);
  const last = at(10);

  it('fix derrière un marqueur extrapolé (avance fictive de 15 m) : RETENU', () => {
    const current = at(25); // marqueur avancé par dead reckoning
    const next = at(20); // le fix réel suivant est derrière
    expect(isBackwardJitter(prev, last, current, next)).toBe(true);
  });

  it('fix devant le marqueur : jamais retenu (le véhicule avance normalement)', () => {
    expect(isBackwardJitter(prev, last, at(10), at(20))).toBe(false);
  });

  it('recul supérieur au plafond : correction réelle acceptée (pas de marqueur figé)', () => {
    expect(isBackwardJitter(prev, last, at(100), at(100 - MAX_BACKWARD_HOLD_M - 5))).toBe(false);
  });

  it('sens de marche inconnu (véhicule quasi immobile) : jamais retenu', () => {
    expect(isBackwardJitter(at(0), at(1), at(10), at(5))).toBe(false);
    expect(isBackwardJitter(null, last, at(25), at(20))).toBe(false);
  });

  it('déplacement latéral pur (virage) : pas un recul', () => {
    expect(isBackwardJitter(prev, last, at(10), at(10, 15))).toBe(false);
  });
});

describe('deadReckonHorizonMs — avance fictive bornée en distance', () => {
  it('à 8 m/s, jamais plus de 30 m d’avance fictive (avant : 15 s ≈ 120 m)', () => {
    const ms = deadReckonHorizonMs(8, 15_000);
    expect((ms / 1000) * 8).toBeLessThanOrEqual(MAX_DEAD_RECKON_DISTANCE_M + 0.01);
  });
  it('à 1 m/s, l’horizon temporel d’origine reste le plafond', () => {
    expect(deadReckonHorizonMs(1, 15_000)).toBe(15_000);
  });
  it('vitesse ou horizon nuls : 0', () => {
    expect(deadReckonHorizonMs(0, 15_000)).toBe(0);
    expect(deadReckonHorizonMs(5, 0)).toBe(0);
  });
});
