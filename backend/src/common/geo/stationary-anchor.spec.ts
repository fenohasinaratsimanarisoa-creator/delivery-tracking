import { computeAnchoredPosition, isStoppedFix, type AnchorFix } from './stationary-anchor';
import { haversineDistance } from './geo.utils';

// AUDIT PRÉCISION GPS PHYSIQUE 2026-09-09 — ancre à l'arrêt.
// Reproduit le nuage réel de la moto garée (device 869890085158149) : les fixes à
// 14-15 sat sont groupés, ceux à 5-7 sat dérivent de ~45 m.

const T0 = new Date('2026-09-09T08:00:00.000Z');

// ~111 m par 0.001° de latitude.
const M = 1 / 111_320;
const fix = (
  dNorthM: number,
  dEastM: number,
  accuracy: number,
  tMinFromStart: number,
  extra: Partial<AnchorFix> = {},
): AnchorFix => ({
  latitude: -18.8632 + dNorthM * M,
  longitude: 47.5639 + dEastM * M,
  accuracy,
  speed: 0,
  motion: false,
  timestamp: new Date(T0.getTime() + tMinFromStart * 60_000),
  ...extra,
});

describe('isStoppedFix', () => {
  it('motion=false → arrêt ; motion=true → mouvement ; sinon vitesse', () => {
    expect(isStoppedFix({ ...fix(0, 0, 10, 0), motion: false })).toBe(true);
    expect(isStoppedFix({ ...fix(0, 0, 10, 0), motion: true })).toBe(false);
    expect(isStoppedFix({ ...fix(0, 0, 10, 0), motion: null, speed: 0.2 })).toBe(true);
    expect(isStoppedFix({ ...fix(0, 0, 10, 0), motion: null, speed: 5 })).toBe(false);
    expect(isStoppedFix({ ...fix(0, 0, 10, 0), motion: null, speed: null })).toBe(true);
  });
});

describe('computeAnchoredPosition', () => {
  it('véhicule garé : ancre = centroïde pondéré, recalé sur les BONS fixes', () => {
    // 2 bons fixes (8 m) au centre, 3 fixes faibles (35-90 m) dérivant vers le sud.
    const fixes: AnchorFix[] = [
      fix(0, 0, 8, 0),
      fix(2, -1, 8, 5),
      fix(-30, 4, 35, 12),
      fix(-45, 6, 90, 20),
      fix(-38, 2, 55, 28), // le plus récent = un fix faible au sud
    ];
    const anchor = computeAnchoredPosition(fixes);
    expect(anchor).not.toBeNull();
    // L'ancre doit être BEAUCOUP plus proche des bons fixes (nord) que du dernier
    // fix brut (à ~38 m au sud).
    const distToGood = haversineDistance(anchor!.latitude, anchor!.longitude, -18.8632, 47.5639);
    const distToRawLast = haversineDistance(
      anchor!.latitude,
      anchor!.longitude,
      -18.8632 - 38 * M,
      47.5639 + 2 * M,
    );
    expect(distToGood).toBeLessThan(12);
    expect(distToRawLast).toBeGreaterThan(25);
  });

  it('stable : deux appels successifs (dernier fix qui saute) donnent quasi la même ancre', () => {
    const base: AnchorFix[] = [fix(0, 0, 8, 0), fix(1, 1, 10, 5), fix(-40, 3, 60, 12)];
    const a1 = computeAnchoredPosition([...base, fix(-45, 8, 75, 20)])!;
    const a2 = computeAnchoredPosition([...base, fix(35, -10, 80, 21)])!;
    expect(haversineDistance(a1.latitude, a1.longitude, a2.latitude, a2.longitude)).toBeLessThan(6);
  });

  it('véhicule en mouvement (dernier fix) → null (position brute / map-matchée)', () => {
    const fixes: AnchorFix[] = [
      fix(0, 0, 10, 0),
      fix(2, 2, 10, 2),
      { ...fix(50, 40, 12, 4), motion: true, speed: 8 },
    ];
    expect(computeAnchoredPosition(fixes)).toBeNull();
  });

  it("s'arrête au premier fix en mouvement en remontant : n'ancre pas sur un arrêt précédent", () => {
    const fixes: AnchorFix[] = [
      fix(500, 500, 10, 0), // arrêt A, loin
      fix(501, 501, 10, 5),
      { ...fix(250, 250, 12, 10), motion: true, speed: 9 }, // trajet A→B
      fix(0, 0, 10, 15), // arrêt B (courant)
      fix(3, -2, 12, 20),
      fix(-4, 1, 15, 25),
    ];
    const anchor = computeAnchoredPosition(fixes);
    expect(anchor).not.toBeNull();
    // Ancre proche de B (0,0), PAS de A (~700 m).
    expect(haversineDistance(anchor!.latitude, anchor!.longitude, -18.8632, 47.5639)).toBeLessThan(
      15,
    );
  });

  it('pas assez de fixes → null (position brute)', () => {
    expect(computeAnchoredPosition([fix(0, 0, 10, 0)])).toBeNull();
    expect(computeAnchoredPosition([])).toBeNull();
  });

  it('fixes hors fenêtre temporelle (> 90 min avant le courant) → exclus', () => {
    const fixes: AnchorFix[] = [
      fix(0, 0, 8, 0), // t=0
      fix(1, 1, 8, 200), // t=+200 min → hors fenêtre par rapport au courant
      fix(2, -1, 10, 240), // courant
    ];
    // Seuls les 2 derniers (t=200, 240) sont dans la fenêtre : ancre ≈ leur centroïde.
    const anchor = computeAnchoredPosition(fixes)!;
    expect(anchor).not.toBeNull();
    expect(
      haversineDistance(anchor.latitude, anchor.longitude, -18.8632 + 1.5 * M, 47.5639),
    ).toBeLessThan(3);
  });
});
