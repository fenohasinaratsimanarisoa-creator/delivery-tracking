import { describe, it, expect } from 'vitest';
import { computeAnimationDuration, MAX_ANIMATION_MS, FALLBACK_ANIMATION_MS } from './animationTiming';

describe('computeAnimationDuration — durée d\'animation basée sur le délai RÉEL', () => {
  it('utilise le delta réel entre les deux positions reçues (cadence native 3s → 3000ms)', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev + 3000)).toBe(3000);
  });

  it('reflète les intervalles variables (natif vs JS) sans durée fixe', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev + 2500)).toBe(2500);
    // 5s d'écart (natif arrière-plan) : au-dessus du cap de fluidité → plafonné,
    // jamais de rattrapage artificiel.
    expect(computeAnimationDuration(prev, prev + 5000)).toBe(MAX_ANIMATION_MS);
  });

  it('ne « rattrape » pas un long gap de reconnexion : durée plafonnée', () => {
    const prev = 1750000000000;
    // 10 minutes d'écart (reconnexion après coupure) : pas 600 000ms d'animation.
    expect(computeAnimationDuration(prev, prev + 600_000)).toBe(MAX_ANIMATION_MS);
    expect(computeAnimationDuration(prev, prev + 60_000)).toBe(MAX_ANIMATION_MS);
  });

  it('garde une animation rapide pour les rafales (positions toutes les 50ms)', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev + 50)).toBe(50);
  });

  it('utilise le repli (600ms) au premier fix ou si le timestamp est indisponible', () => {
    expect(computeAnimationDuration(null, 1750000000000)).toBe(FALLBACK_ANIMATION_MS);
    expect(computeAnimationDuration(1750000000000, null)).toBe(FALLBACK_ANIMATION_MS);
    expect(computeAnimationDuration(null, null)).toBe(FALLBACK_ANIMATION_MS);
  });

  it('utilise le repli si l\'horloge dérive (delta ≤ 0)', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev)).toBe(FALLBACK_ANIMATION_MS);
    expect(computeAnimationDuration(prev + 500, prev)).toBe(FALLBACK_ANIMATION_MS);
  });
});