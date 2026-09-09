import {
  selectMatchWindow,
  matchRadiuses,
  acceptSnappedTail,
  MATCH_MIN_FIXES,
  MATCH_WINDOW_SIZE,
  MATCH_MAX_SNAP_DISTANCE_M,
  type MatchFix,
} from './live-map-match';

const fix = (lat: number, lng: number, accuracy?: number): MatchFix => ({
  latitude: lat,
  longitude: lng,
  accuracy,
});

describe('selectMatchWindow', () => {
  it('null si moins de MATCH_MIN_FIXES', () => {
    const few = Array.from({ length: MATCH_MIN_FIXES - 1 }, (_, i) => fix(-18.8 + i * 1e-4, 47.5));
    expect(selectMatchWindow(few)).toBeNull();
    expect(selectMatchWindow([])).toBeNull();
  });

  it('les MATCH_WINDOW_SIZE derniers fixes, chronologiques', () => {
    const many = Array.from({ length: 20 }, (_, i) => fix(-18.8 + i * 1e-4, 47.5));
    const w = selectMatchWindow(many)!;
    expect(w).toHaveLength(MATCH_WINDOW_SIZE);
    expect(w[0].latitude).toBeCloseTo(-18.8 + (20 - MATCH_WINDOW_SIZE) * 1e-4, 8);
    expect(w[w.length - 1].latitude).toBeCloseTo(-18.8 + 19 * 1e-4, 8);
  });
});

describe('matchRadiuses', () => {
  it('borné entre 15 et 50 m, défaut 25 si accuracy absente', () => {
    const w = [fix(-18.8, 47.5, 5), fix(-18.8, 47.5, 30), fix(-18.8, 47.5, 999), fix(-18.8, 47.5)];
    expect(matchRadiuses(w)).toEqual([15, 30, 50, 25]);
  });
});

describe('acceptSnappedTail', () => {
  const raw = { latitude: -18.8792, longitude: 47.5079 };

  it('rejette si pas de point accroché', () => {
    expect(acceptSnappedTail(raw, null, 0.9)).toBeNull();
    expect(acceptSnappedTail(raw, undefined, 0.9)).toBeNull();
  });

  it('rejette si confiance OSRM trop faible', () => {
    expect(acceptSnappedTail(raw, [-18.8792, 47.5079], 0.3)).toBeNull();
  });

  it('rejette si le point accroché est trop loin du fix brut (route parallèle)', () => {
    // ~120 m au nord
    const far: [number, number] = [-18.8792 + 120 / 111320, 47.5079];
    expect(acceptSnappedTail(raw, far, 0.95)).toBeNull();
  });

  it('accepte un accrochage proche et confiant', () => {
    // ~20 m — accrochage sur la même route
    const near: [number, number] = [-18.8792 + 20 / 111320, 47.5079];
    const r = acceptSnappedTail(raw, near, 0.9);
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(near[0], 8);
  });

  it('limite exacte : ≤ MATCH_MAX_SNAP_DISTANCE_M accepté', () => {
    const atLimit: [number, number] = [
      -18.8792 + (MATCH_MAX_SNAP_DISTANCE_M - 1) / 111320,
      47.5079,
    ];
    expect(acceptSnappedTail(raw, atLimit, 0.8)).not.toBeNull();
  });
});
