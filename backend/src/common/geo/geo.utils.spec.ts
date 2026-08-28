import { computeFilteredDistance, collapseStationaryWindows } from './geo.utils';

// =============================================================================
// AUDIT TERRAIN 2026-08-28 — sur-comptage confirme sur trace REELLE de production
// (voir geo.utils.ts, bloc "AUDIT TERRAIN 2026-08-28").
//
// Trajet aller-retour reel, deplacement net = 0, zone ~16 km, distance reelle
// estimee ~40 km -> le rapport carburant affichait 87 km. La reconstruction
// segment par segment a montre ~33 km de BRUIT PUR provenant des fixes a
// accuracy > 80 m, comptes integralement par l'ancien seuil plafonne a 7,5 m.
//
// computeFilteredDistance v3 :
//   1. deux fixes a accuracy > 80 m  -> segment ignore (bruit) ;
//   2. vitesse Doppler fiable (<= 50 m) -> deplacement reel BORNE par vitesse x dt ;
//   3. sinon -> compte seulement si le segment depasse 2 x rms(accuracy).
//
// Ces tests utilisent des timestamps (comme toute position reelle en base) :
// sans dt, la borne vitesse x dt ne peut pas s'appliquer.
// =============================================================================
describe('computeFilteredDistance v3 — bruit GPS non compte comme distance (audit 2026-08-28)', () => {
  const T0 = new Date('2026-08-28T06:00:00.000Z').getTime();
  const at = (i: number) => new Date(T0 + i * 3000); // fixes toutes les 3 s

  // 0.0001 deg de latitude ~= 11.1 m ; 0.0005 ~= 55.6 m ; 0.00002 ~= 2.2 m
  it('IGNORE un segment dont les DEUX fixes ont accuracy > 80 m (bruit pur)', () => {
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 120, speed: 2, timestamp: at(0) },
      { latitude: 0.0005, longitude: 0, accuracy: 140, speed: 2, timestamp: at(1) },
    ];
    // Meme avec speed = 2 m/s : a 120-140 m d'incertitude, la vitesse Doppler
    // est elle aussi du bruit. Segment ignore.
    expect(computeFilteredDistance(positions)).toBe(0);
  });

  it('BORNE la distance par vitesse x dt quand le saut de position est du jitter', () => {
    // Le device dit 2 m/s pendant 3 s => ~6 m parcourus. Le "saut" GPS fait 55 m
    // (jitter en accuracy 45 m). On compte ~vitesse x dt x 1.5 = 9 m, PAS 55 m.
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 45, speed: 2, timestamp: at(0) },
      { latitude: 0.0005, longitude: 0, accuracy: 45, speed: 2, timestamp: at(1) },
    ];
    const d = computeFilteredDistance(positions);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(12); // borne = 2 * 3 * 1.5 = 9 m
  });

  it('compte INTEGRALEMENT un vrai deplacement : vitesse fiable, saut coherent avec la vitesse', () => {
    // 15 m/s pendant 3 s => 45 m attendus, le saut GPS fait ~44.5 m : coherent.
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 8, speed: 15, timestamp: at(0) },
      { latitude: 0.0004, longitude: 0, accuracy: 8, speed: 15, timestamp: at(1) },
    ];
    const d = computeFilteredDistance(positions);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(50);
  });

  it("IGNORE une micro-derive (< bruit combine) a l'arret, accuracy degradee, sans vitesse", () => {
    // Immobile : accuracy 46 m, pas de vitesse. Derive de 11 m entre deux fixes.
    // rms(46,46) ~= 46 -> seuil = 2 x 46 = 92 m. 11 m << 92 m -> 0.
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 46, speed: null, timestamp: at(0) },
      { latitude: 0.0001, longitude: 0, accuracy: 46, speed: null, timestamp: at(1) },
    ];
    expect(computeFilteredDistance(positions)).toBe(0);
  });

  it("IGNORE une derive a l'arret meme si le device rapporte une pseudo-vitesse faible", () => {
    // speed 1.5 m/s mais accuracy 46 m : sous le seuil de confiance vitesse (50 m)
    // la regle vitesse s'applique et BORNE a 1.5 x 3 x 1.5 = 6.75 m ; le saut
    // reel fait ~2.2 m -> on compte ~2.2 m (coherent avec une marche tres lente).
    // Le point clef : on ne compte PLUS 55 m sur un saut de bruit.
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 46, speed: 1.5, timestamp: at(0) },
      { latitude: 0.00002, longitude: 0, accuracy: 46, speed: 1.5, timestamp: at(1) },
      { latitude: 0.0005, longitude: 0, accuracy: 46, speed: 1.5, timestamp: at(2) },
    ];
    const d = computeFilteredDistance(positions);
    // segment 1 : ~2.2 m (coherent vitesse) ; segment 2 : saut de 53 m borne a 6.75 m.
    expect(d).toBeLessThan(12);
  });

  it('preserve un trajet propre a accuracy degradee TANT QUE le device rapporte la vitesse', () => {
    // 200 fixes, 3 s, 15 m/s => trajet reel de ~9 km. Accuracy 40 m (ville dense)
    // mais vitesse Doppler presente : la distance doit rester proche du reel.
    const positions = Array.from({ length: 200 }, (_, i) => ({
      latitude: (15 * 3 * i) / 111320, // avance de 45 m par pas
      longitude: 0,
      accuracy: 40,
      speed: 15,
      timestamp: at(i),
    }));
    const km = computeFilteredDistance(positions) / 1000;
    expect(km).toBeGreaterThan(8.5);
    expect(km).toBeLessThan(9.5);
  });
});

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit terrain 2026-08-27, complément) : même après le
// garde-fou d'accuracy ci-dessus, la sommation pairwise accumule encore de la
// dérive GPS sur de longues périodes stationnaires (chaque micro-segment reste
// individuellement plausible). collapseStationaryWindows() traite une suite de
// positions RESTANT DANS UN PETIT RAYON, ÉCHANTILLONNÉE DENSÉMENT, PENDANT
// LONGTEMPS comme un arrêt unique — mais seulement si TOUTES ces conditions
// tiennent, pour ne jamais effacer un vrai trajet lent et rarement échantillonné.
// =============================================================================
describe('collapseStationaryWindows — arrêt confirmé (rayon + densité + durée) (audit 2026-08-27)', () => {
  const T0 = new Date('2026-08-27T00:00:00.000Z').getTime();

  it('collapse un arrêt confirmé : dérive < 30m, échantillonnage dense (≤60s), durée ≥5min', () => {
    // 40 positions sur 10 minutes (15s d'intervalle), dérive aléatoire mais bornée
    // à ~10m autour d'un point fixe — un arrêt réel typique (accuracy correcte,
    // léger bruit de position).
    const positions = Array.from({ length: 40 }, (_, i) => ({
      latitude: 0 + (i % 2 === 0 ? 0.00005 : -0.00003), // ~5.5m / 3.3m d'oscillation
      longitude: 0,
      timestamp: new Date(T0 + i * 15_000),
    }));
    const collapsed = collapseStationaryWindows(positions);
    expect(collapsed.length).toBeLessThan(positions.length);
    expect(collapsed.length).toBe(1); // toute la fenêtre est un seul arrêt
  });

  it('NE collapse PAS une progression réelle mais peu échantillonnée (>60s entre fixes), même si chaque saut est < 30m', () => {
    // Reproduit exactement le scénario "Non-régression (b)" de
    // fuel-consumption.service.spec.ts : 9 positions à 1h d'intervalle, ~22m par
    // saut. Sans le garde-fou de densité, ceci serait à tort traité comme un
    // arrêt de 8h.
    const positions = Array.from({ length: 9 }, (_, i) => ({
      latitude: i * 0.0002,
      longitude: 0,
      timestamp: new Date(T0 + i * 3_600_000), // 1h d'intervalle
    }));
    const collapsed = collapseStationaryWindows(positions);
    expect(collapsed.length).toBe(positions.length); // rien collapsé
  });

  it('NE collapse PAS une fenêtre trop courte (< 5 min), même dense et immobile', () => {
    const positions = Array.from({ length: 10 }, (_, i) => ({
      latitude: 0,
      longitude: 0,
      timestamp: new Date(T0 + i * 10_000), // 10s d'intervalle, 100s au total < 5min
    }));
    const collapsed = collapseStationaryWindows(positions);
    expect(collapsed.length).toBe(positions.length); // rien collapsé (fenêtre trop courte)
  });

  it('repli sûr : ne modifie rien si un timestamp manque', () => {
    const positions = [
      { latitude: 0, longitude: 0, timestamp: new Date(T0) },
      { latitude: 0, longitude: 0 }, // timestamp manquant
      { latitude: 0, longitude: 0, timestamp: new Date(T0 + 1000) },
    ];
    const collapsed = collapseStationaryWindows(positions as any);
    expect(collapsed).toEqual(positions);
  });

  it('réduit significativement la distance calculée pour un arrêt confirmé, via computeFilteredDistance', () => {
    const positions = Array.from({ length: 40 }, (_, i) => ({
      latitude: 0 + (i % 3 === 0 ? 0.00006 : i % 3 === 1 ? -0.00004 : 0),
      longitude: 0,
      accuracy: 15,
      speed: null,
      timestamp: new Date(T0 + i * 15_000),
    }));
    const distance = computeFilteredDistance(positions);
    expect(distance).toBe(0); // arrêt entièrement collapsé : un seul point restant
  });
});

// =============================================================================
// VERROU DE NON-REGRESSION — reproduit le cas de production du 2026-08-28 :
// trajet aller-retour (le chauffeur rentre chez lui, deplacement net ~= 0),
// melant des heures a bon signal (accuracy 10-20 m, vitesse presente) et des
// heures a signal degrade (accuracy 60-150 m). L ancien algo affichait ~2x la
// distance reelle. computeFilteredDistance v3 doit rester proche du reel.
// =============================================================================
describe('computeFilteredDistance v3 — non-regression trajet reel (aller-retour, signal mixte)', () => {
  const T0 = new Date('2026-08-28T05:00:00.000Z').getTime();
  const M_PER_DEG_LAT = 111_320;
  type P = {
    latitude: number;
    longitude: number;
    accuracy: number;
    speed: number | null;
    timestamp: Date;
  };

  function build(): P[] {
    const pts: P[] = [];
    let t = 0;
    let lat = 0;
    const push = (acc: number, spd: number | null) => {
      pts.push({
        latitude: lat,
        longitude: 0,
        accuracy: acc,
        speed: spd,
        timestamp: new Date(T0 + t * 1000),
      });
      t += 3;
    };
    for (let i = 0; i < 800; i++) {
      lat += (Math.sin(i) * 6) / M_PER_DEG_LAT;
      push(30 + (i % 5) * 10, i % 7 === 0 ? 0.4 : null);
    }
    const home = lat;
    for (let i = 0; i < 280; i++) {
      lat += 36 / M_PER_DEG_LAT;
      push(8 + (i % 6) * 2, 12);
    }
    for (let i = 0; i < 300; i++) {
      lat += (Math.sin(i * 1.3) * 25) / M_PER_DEG_LAT;
      push(70 + (i % 4) * 25, null);
    }
    const afterDense = lat;
    for (let i = 0; i < 280; i++) {
      lat -= (afterDense - home) / 280;
      push(8 + (i % 6) * 2, 12);
    }
    return pts;
  }

  it('la distance reste proche du reel (~20 km) et NE double PAS a cause du bruit', () => {
    const pts = build();
    const net = Math.abs(pts[pts.length - 1].latitude - pts[0].latitude) * M_PER_DEG_LAT;
    expect(net).toBeLessThan(300);
    const km = computeFilteredDistance(pts) / 1000;
    expect(km).toBeGreaterThan(16);
    expect(km).toBeLessThan(24);
  });

  it('les heures "maison" et "zone dense sans vitesse" ne contribuent quasi rien', () => {
    const pts = build();
    expect(computeFilteredDistance(pts.slice(0, 800)) / 1000).toBeLessThan(0.3);
    expect(computeFilteredDistance(pts.slice(1080, 1380)) / 1000).toBeLessThan(0.6);
  });
});
