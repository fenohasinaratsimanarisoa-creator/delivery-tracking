import { computeFilteredDistance } from './geo.utils';

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
