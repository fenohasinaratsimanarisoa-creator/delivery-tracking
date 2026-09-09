import { describe, it, expect } from 'vitest';
import {
  computeAnimationDuration,
  MAX_ANIMATION_MS,
  GAP_ANIMATION_MS,
  FALLBACK_ANIMATION_MS,
} from './animationTiming';

describe('computeAnimationDuration — durée d\'animation basée sur le délai RÉEL', () => {
  it('utilise le delta réel entre les deux positions reçues (cadence native 3s → 3000ms)', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev + 3000)).toBe(3000);
  });

  it('reflète les intervalles variables (natif vs JS) sans durée fixe', () => {
    const prev = 1750000000000;
    expect(computeAnimationDuration(prev, prev + 2500)).toBe(2500);
    // 5s d'écart : glisse les 5s réelles (sous le cap de fluidité).
    expect(computeAnimationDuration(prev, prev + 5000)).toBe(5000);
  });

  it('lisse la cadence lente d\'un traceur physique (1 point / ~18s) jusqu\'au cap', () => {
    const prev = 1750000000000;
    // 18s entre deux fixes (GT06 en mouvement) : le marqueur glisse en continu.
    expect(computeAnimationDuration(prev, prev + 18_000)).toBe(18_000);
    // 30s : plafonné au cap de fluidité, jamais au-delà.
    expect(computeAnimationDuration(prev, prev + 30_000)).toBe(MAX_ANIMATION_MS);
  });

  it('ne « rattrape » pas un gap de reconnexion : repositionnement net (FALLBACK)', () => {
    const prev = 1750000000000;
    // 10 minutes d'écart (reconnexion) : pas 20s de rampe sur une distance énorme.
    expect(computeAnimationDuration(prev, prev + 600_000)).toBe(FALLBACK_ANIMATION_MS);
    expect(computeAnimationDuration(prev, prev + 60_000)).toBe(FALLBACK_ANIMATION_MS);
    // Juste au-dessus du seuil de gap.
    expect(computeAnimationDuration(prev, prev + GAP_ANIMATION_MS + 1)).toBe(FALLBACK_ANIMATION_MS);
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
