import {
  computeFilteredDistance,
  detectStopWindows,
  collapseStationaryWindows,
  STOP_CLUSTER_RADIUS_M,
} from './geo.utils';

// =============================================================================
// AUDIT « ÉCART À L'ARRÊT = FAUX TRAJET » 2026-09-19.
//
// À l'arrêt, la position GPS dérive autour de l'endroit réel et cette dérive était
// comptée comme un trajet. Cause : le GT06 déduit `accuracy` du nombre de satellites
// (15 sat → 8 m, jamais mesurée) alors que son erreur RÉELLE au repos est de 12-20 m ;
// le seuil de bruit (2 × 8 = 16 m) était franchi en permanence.
// Simulation AVANT correctif, véhicule IMMOBILE, précision annoncée 8 m :
//   erreur réelle 12 m → 346 m / 10 min ; 20 m → 1360 m / 10 min (6 km / h).
// Générateur pseudo-aléatoire DÉTERMINISTE : ces tests ne sont jamais aléatoires.
// =============================================================================

const M = 1 / 111_320;
const T0 = 1_800_000_000_000;

function makeRng(seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  return gauss;
}

type Fix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  timestamp: Date;
};

/** Erreur GPS = processus AR(1) corrélé (biais qui dérive) + bruit blanc de 1,5 m. */
function drive(segs: Array<[number, number]>, cadence: number, sigma: number, seed: number) {
  const gauss = makeRng(seed);
  const a = Math.exp(-cadence / 30);
  let ex = 0;
  let ey = 0;
  let north = 0;
  let truth = 0;
  let t = 0;
  const out: Fix[] = [];
  for (const [durS, speed] of segs) {
    for (let k = 0; k < durS; k += cadence) {
      north += speed * cadence;
      truth += speed * cadence;
      ex = a * ex + Math.sqrt(1 - a * a) * sigma * gauss();
      ey = a * ey + Math.sqrt(1 - a * a) * sigma * gauss();
      t += cadence;
      out.push({
        latitude: -18.87 + (north + ey + gauss() * 1.5) * M,
        longitude: 47.55 + (ex + gauss() * 1.5) * M,
        accuracy: 8, // annoncée (15 sat) — l'erreur réelle est `sigma`
        speed: speed > 1 ? speed : 0,
        timestamp: new Date(T0 + t * 1000),
      });
    }
  }
  return { fixes: out, truthM: truth };
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

describe('véhicule IMMOBILE, précision annoncée 8 m, erreur réelle plus grande', () => {
  it.each([
    [8, 15],
    [12, 30],
    [20, 250],
  ])(
    'erreur réelle σ=%i m : moins de %i m de distance fantôme en 10 min (avant : 0 / 346 / 1360 m)',
    (sigma, maxM) => {
      const d = avg(
        seeds.map((s) => computeFilteredDistance(drive([[600, 0]], 5, sigma, s).fixes)),
      );
      expect(d).toBeLessThan(maxM);
    },
  );

  it('1 heure immobile à σ=12 m : moins de 60 m (avant : ≈ 640-1100 m)', () => {
    const d = avg(
      seeds.slice(0, 4).map((s) => computeFilteredDistance(drive([[3600, 0]], 10, 12, s).fixes)),
    );
    expect(d).toBeLessThan(60);
  });
});

describe('les VRAIS trajets sont préservés', () => {
  const within = (got: number, truth: number, tol: number) => {
    expect(got).toBeGreaterThan(truth * (1 - tol));
    expect(got).toBeLessThan(truth * (1 + tol) + 30);
  };

  it('circulation 3 m/s pendant 10 min : distance conservée (±10 %)', () => {
    const rs = seeds.map((s) => {
      const t = drive([[600, 3]], 5, 8, s);
      return { got: computeFilteredDistance(t.fixes), truth: t.truthM };
    });
    within(avg(rs.map((r) => r.got)), rs[0].truth, 0.1);
  });

  it('arrêts-départs (30 s à 5 m/s / 30 s arrêt) ×10 : jamais moins que le réel', () => {
    const segs = Array.from({ length: 10 }, () => [
      [30, 5],
      [30, 0],
    ]).flat() as Array<[number, number]>;
    const rs = seeds.map((s) => {
      const t = drive(segs, 5, 8, s);
      return { got: computeFilteredDistance(t.fixes), truth: t.truthM };
    });
    within(avg(rs.map((r) => r.got)), rs[0].truth, 0.1);
  });

  it("5 min de trajet + 2 min d'arrêt + 5 min de trajet : distance conservée (±5 %)", () => {
    const rs = seeds.map((s) => {
      const t = drive(
        [
          [300, 8],
          [120, 0],
          [300, 8],
        ],
        5,
        8,
        s,
      );
      return { got: computeFilteredDistance(t.fixes), truth: t.truthM };
    });
    within(avg(rs.map((r) => r.got)), rs[0].truth, 0.05);
  });
});

describe('detectStopWindows / collapseStationaryWindows', () => {
  it('un arrêt de 2 min devient UN point : son centre, horodaté au dernier fix', () => {
    const fixes = drive(
      [
        [60, 8],
        [120, 0],
        [60, 8],
      ],
      5,
      6,
      3,
    ).fixes;
    const stops = detectStopWindows(fixes);
    expect(stops).toHaveLength(1);
    expect(stops[0].durationSec).toBeGreaterThanOrEqual(60);
    const collapsed = collapseStationaryWindows(fixes);
    expect(collapsed.length).toBeLessThan(fixes.length - 10);
    // le point de l'arrêt est le centre, pas un fix dérivé quelconque
    const idx = collapsed.findIndex(
      (p) =>
        Math.abs(p.latitude - stops[0].latitude) < 1e-9 &&
        Math.abs(p.longitude - stops[0].longitude) < 1e-9,
    );
    expect(idx).toBeGreaterThan(0);
  });

  it("un véhicule qui roule n'a aucun arrêt", () => {
    expect(detectStopWindows(drive([[300, 6]], 5, 8, 2).fixes)).toHaveLength(0);
  });

  it("un arrêt plus court que 60 s n'est pas un arrêt", () => {
    const fixes = drive([[40, 0]], 5, 6, 2).fixes;
    expect(detectStopWindows(fixes)).toHaveLength(0);
  });

  it("un trou d'échantillonnage (> 60 s) sépare deux arrêts distincts", () => {
    const a = drive([[90, 0]], 5, 4, 1).fixes;
    const b = drive([[90, 0]], 5, 4, 2).fixes.map((f) => ({
      ...f,
      timestamp: new Date(f.timestamp.getTime() + 400_000),
    }));
    expect(detectStopWindows([...a, ...b])).toHaveLength(2);
  });

  it("repli sûr : sans timestamp, rien n'est détecté ni modifié", () => {
    const noTs = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
    ];
    expect(detectStopWindows(noTs)).toHaveLength(0);
    expect(collapseStationaryWindows(noTs)).toBe(noTs);
  });

  it("le rayon d'arrêt reste borné (un déplacement réel ne peut pas être absorbé)", () => {
    expect(STOP_CLUSTER_RADIUS_M).toBeLessThanOrEqual(60);
  });
});
