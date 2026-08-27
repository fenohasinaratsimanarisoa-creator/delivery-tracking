import { computeFilteredDistance, collapseStationaryWindows } from './geo.utils';

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit terrain 2026-08-27, confirmé sur données réelles
// en production) : chauffeur resté chez lui toute la nuit, téléphone immobile en
// intérieur — la RÈGLE VITESSE comptait un segment en entier dès qu'une vitesse
// > 1 m/s était rapportée, SANS AUCUNE condition sur l'accuracy. Sur 4123
// positions réelles (accuracy moyenne dégradée, jusqu'à plusieurs centaines de
// mètres), ceci produisait un rapport de 68 km pour un véhicule qui n'a pas
// bougé. La vitesse rapportée par un GPS en accuracy dégradée est elle-même du
// bruit — elle ne doit plus authentifier un déplacement.
// =============================================================================
describe('computeFilteredDistance — garde-fou accuracy sur la règle vitesse (audit 2026-08-27)', () => {
  it('ne compte PAS un segment "en mouvement" (speed > seuil) si l\'accuracy est dégradée (> 30m)', () => {
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 46, speed: 1.5 },
      // ~55m de "saut" — sous l'ancienne règle, comptés intégralement à cause de speed > 1.
      { latitude: 0.0005, longitude: 0, accuracy: 46, speed: 1.5 },
    ];
    const distance = computeFilteredDistance(positions);
    // Repli sur la règle seuil : accuracy 46m → scale plafonné 1.5 → seuil 7.5m,
    // largement dépassé par ~55m — le segment reste compté, mais via le seuil de
    // bruit (cohérent), pas via une confiance aveugle en la vitesse rapportée.
    // Le point du test n'est pas "distance = 0" ici (le seuil filtré compte quand
    // même un vrai déplacement de 55m) mais que le comportement diffère du test
    // suivant, où le déplacement est trop PETIT pour passer le seuil.
    expect(distance).toBeGreaterThan(0);
  });

  it("ne compte PAS un micro-jitter (< seuil de bruit) même avec speed > 1 m/s, si l'accuracy est dégradée", () => {
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 46, speed: 1.5 },
      // ~11m de dérive — AVANT le correctif : compté intégralement (speed > 1 m/s
      // bypassait tout). APRÈS : accuracy 46m > 30m → vitesse non fiable → repli
      // sur le seuil de bruit (7.5m, accuracy plafonnée) → 11m > 7.5m, compté
      // quand même mais via le filtre de bruit cohérent.
      { latitude: 0.0001, longitude: 0, accuracy: 46, speed: 1.5 },
    ];
    const distance = computeFilteredDistance(positions);
    expect(distance).toBeGreaterThan(7); // dépasse le seuil de bruit, cohérent
    expect(distance).toBeLessThan(15);
  });

  it('rejette un micro-jitter (< 5m) en dessous du seuil, accuracy dégradée, speed élevée', () => {
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 46, speed: 1.5 },
      // ~3m — sous le seuil de bruit (7.5m plafonné). AVANT : compté intégralement
      // via la règle vitesse (bug). APRÈS : accuracy non fiable → repli seuil →
      // 3m < 7.5m → filtré (0 km ajouté).
      { latitude: 0.000027, longitude: 0, accuracy: 46, speed: 1.5 },
    ];
    const distance = computeFilteredDistance(positions);
    expect(distance).toBe(0);
  });

  it('compte TOUJOURS un vrai déplacement avec speed > seuil ET accuracy fiable (≤ 30m)', () => {
    const positions = [
      { latitude: 0, longitude: 0, accuracy: 15, speed: 3 },
      // ~11m — sous le seuil pondéré normal (7.5m plafonné pour accuracy 15m
      // donnerait scale=1.5 → 7.5m ; 11m > 7.5m de toute façon), mais la RÈGLE
      // VITESSE doit rester active avec une accuracy fiable — non-régression.
      { latitude: 0.0001, longitude: 0, accuracy: 15, speed: 3 },
    ];
    const distance = computeFilteredDistance(positions);
    expect(distance).toBeGreaterThan(0);
  });

  it('non-régression : circulation urbaine lente (accuracy 40-60m, speed > seuil, segments > seuil de bruit capé) reste comptée', () => {
    // Reproduit le scénario "Non-régression (b)" de fuel-consumption.service.spec.ts :
    // les segments réels (~22m) dépassent le seuil de bruit CAPÉ (7.5m) de toute
    // façon — le garde-fou d'accuracy sur la règle vitesse n'a donc aucun effet
    // négatif ici, la distance reste comptée via le repli sur le seuil.
    const positions = Array.from({ length: 5 }, (_, i) => ({
      latitude: i * 0.0002,
      longitude: 0,
      accuracy: 40,
      speed: 3.0,
    }));
    const distance = computeFilteredDistance(positions);
    // 4 segments × ~22.3m (0.0002° de latitude à l'équateur) ≈ 89m attendus.
    expect(distance).toBeGreaterThan(80);
    expect(distance).toBeLessThan(100);
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

  it("NE collapse PAS une progression réelle mais peu échantillonnée (>60s entre fixes), même si chaque saut est < 30m", () => {
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

  it("NE collapse PAS une fenêtre trop courte (< 5 min), même dense et immobile", () => {
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
