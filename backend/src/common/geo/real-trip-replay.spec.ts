import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveGroundSpeed,
  selectSpeedWindowRef,
  haversineDistance,
  STATIONARY_SPEED_MS,
} from './geo.utils';
import { computeAnchoredPosition, type AnchorFix } from './stationary-anchor';

// =============================================================================
// NON-RÉGRESSION SUR TRAJET RÉEL — « en mouvement → à l'arrêt → retour en arrière »
// (audit 2026-09-19). Trajet GT06 réel de la vidéo du 18/09/2026 ~17h58-18h01 (heure de
// Madagascar) : 153 fixes, 15 satellites, accuracy 8 m, circulation urbaine lente.
// La chaîne rejouée est celle du pont Traccar : resolveGroundSpeed (avec fenêtre) →
// buffer d'ancre → computeAnchoredPosition. La vitesse rapportée par le traceur n'est
// pas conservée en base : on rejoue donc le PIRE cas (traceur qui n'annonce aucune
// vitesse exploitable), la dérivation de position étant seule juge.
//
// Résultats AVANT correctif sur ces mêmes fixes : 61/147 fixes en mouvement déclarés
// « à l'arrêt », 23 sauts arrière, marqueur jusqu'à 490 m derrière le véhicule.
// =============================================================================

type Row = { t: Date; lat: number; lng: number; acc: number };
const fixture: number[][] = JSON.parse(
  readFileSync(join(__dirname, 'real-trip-2026-09-18.fixture.json'), 'utf8'),
);
const rows: Row[] = fixture.map(([t, lat, lng, acc]) => ({
  t: new Date(t * 1000),
  lat,
  lng,
  acc,
}));

interface Replayed {
  speed: number;
  raw: [number, number];
  disp: [number, number];
}

function replay(useWindow: boolean): Replayed[] {
  const buf: AnchorFix[] = [];
  let prev: Row | null = null;
  const out: Replayed[] = [];
  for (const r of rows) {
    const speed = resolveGroundSpeed({
      reportedSpeedMs: 0,
      previous: prev
        ? { latitude: prev.lat, longitude: prev.lng, timestamp: prev.t, accuracy: prev.acc }
        : null,
      current: { latitude: r.lat, longitude: r.lng, timestamp: r.t, accuracy: r.acc },
      windowPrevious: useWindow ? selectSpeedWindowRef(buf, r.t) : null,
    }).speedMs;
    buf.push({
      latitude: r.lat,
      longitude: r.lng,
      accuracy: r.acc,
      speed,
      motion: true,
      timestamp: r.t,
    });
    while (buf.length > 20) buf.shift();
    const a = computeAnchoredPosition(buf);
    out.push({
      speed,
      raw: [r.lat, r.lng],
      disp: a ? [a.latitude, a.longitude] : [r.lat, r.lng],
    });
    prev = r;
  }
  return out;
}

const d = (a: [number, number], b: [number, number]) => haversineDistance(a[0], a[1], b[0], b[1]);

describe('trajet réel GT06 du 2026-09-18 — pas de faux arrêt, jamais de recul', () => {
  const result = replay(true);
  // « en mouvement réel » : déplacement > 30 m entre 3 fixes avant et 3 fixes après.
  const moving = result
    .map((_, i) => i)
    .filter((i) => i >= 3 && i < result.length - 3 && d(result[i - 3].raw, result[i + 3].raw) > 30);

  it('le jeu de données est bien le trajet réel (153 fixes, majorité en mouvement)', () => {
    expect(rows.length).toBeGreaterThan(140);
    expect(moving.length).toBeGreaterThan(120);
  });

  it("moins de 5 % des fixes en mouvement réel sont déclarés « à l'arrêt » (avant : 41 %)", () => {
    const falseStatic = moving.filter((i) => result[i].speed <= STATIONARY_SPEED_MS).length;
    expect(falseStatic / moving.length).toBeLessThan(0.05);
  });

  it('la position affichée ne recule JAMAIS de plus de 10 m par rapport au sens de marche', () => {
    let backJumps = 0;
    for (const i of moving) {
      if (i < 1) continue;
      const rs = [result[i].raw[0] - result[i - 3].raw[0], result[i].raw[1] - result[i - 3].raw[1]];
      const ds = [
        result[i].disp[0] - result[i - 1].disp[0],
        result[i].disp[1] - result[i - 1].disp[1],
      ];
      const step = d(result[i - 1].disp, result[i].disp);
      if (step > 10 && rs[0] * ds[0] + rs[1] * ds[1] < 0) backJumps++;
    }
    expect(backJumps).toBe(0);
  });

  it("le marqueur affiché reste à moins de 25 m du dernier fix précis (avant : jusqu'à 490 m)", () => {
    const maxLag = Math.max(...moving.map((i) => d(result[i].disp, result[i].raw)));
    expect(maxLag).toBeLessThan(25);
  });

  it('SANS la fenêtre de vitesse (ancien comportement) le défaut est bien reproduit — le test est discriminant', () => {
    const old = replay(false);
    const falseStatic = moving.filter((i) => old[i].speed <= STATIONARY_SPEED_MS).length;
    expect(falseStatic / moving.length).toBeGreaterThan(0.3);
  });
});
