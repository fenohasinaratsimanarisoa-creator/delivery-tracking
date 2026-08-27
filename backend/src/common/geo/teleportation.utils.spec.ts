import { evaluateTeleportation } from './teleportation.utils';

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit terrain 2026-08-27, confirmé sur données réelles
// en production) : le seuil de VITESSE de détection de téléportation était
// échelonné par l'accuracy (jusqu'à 55,56 × 1,5 = 83 m/s = 300 km/h). Cas réel :
// un saut GPS de 720 m en 9 s (≈80 m/s = 288 km/h, physiquement impossible pour
// un véhicule) avec une accuracy de 20,9 m (scale plafonné 1,5, seuil relevé à
// 300 km/h) est passé SOUS ce seuil élargi → suspect=false → a alimenté un
// rapport de distance carburant faux (68 km pour un véhicule resté immobile).
// La vitesse ne doit plus être échelonnée : un point dont l'accuracy dégradée
// le fait sembler franchir 200 km/h est du bruit, jamais un déplacement réel.
// =============================================================================
describe('evaluateTeleportation — seuil de vitesse non échelonné par l\'accuracy (audit 2026-08-27)', () => {
  const reference = { latitude: -18.8792, longitude: 47.5079, timestamp: new Date('2026-08-27T00:00:00.000Z') };

  it('DÉTECTE le saut réel observé en production (720m/9s ≈ 288 km/h, accuracy 20.9m)', () => {
    // 720m ≈ 0.00647° de latitude à l'équivalent local (approximation suffisante pour le test).
    const latOffset = 720 / 111320;
    const result = evaluateTeleportation(
      reference,
      reference.latitude + latOffset,
      reference.longitude,
      new Date(reference.timestamp.getTime() + 9000),
      20.9,
    );
    expect(result.suspect).toBe(true);
    expect(result.reason).toBe('vitesse');
  });

  it('REJETTE (suspect=false) un saut plausible sous 200 km/h même avec une accuracy dégradée (avant : passait à tort à 300 km/h)', () => {
    // ~50 km/h (13.9 m/s) sur 10s, accuracy dégradée à 100m — AVANT le correctif,
    // resterait quand même non-suspect (13.9 << 300 km/h) ; le test vérifie que le
    // correctif n'introduit pas de faux positif sur un déplacement réaliste.
    const latOffset = 139 / 111320; // 139m en 10s ≈ 50 km/h
    const result = evaluateTeleportation(
      reference,
      reference.latitude + latOffset,
      reference.longitude,
      new Date(reference.timestamp.getTime() + 10000),
      100,
    );
    expect(result.suspect).toBe(false);
  });

  it('DÉTECTE toujours un saut extrême (>200 km/h) même avec une bonne accuracy (non-régression)', () => {
    const latOffset = 5000 / 111320; // 5km en 5s = 1000 m/s
    const result = evaluateTeleportation(
      reference,
      reference.latitude + latOffset,
      reference.longitude,
      new Date(reference.timestamp.getTime() + 5000),
      5,
    );
    expect(result.suspect).toBe(true);
    expect(result.reason).toBe('vitesse');
  });

  it('non-régression (Scenario 5, tracking.service.spec.ts) : saut ~100 m/s avec accuracy 100m reste détecté', () => {
    const latOffset = 500 / 111320; // ~500m en 5s ≈ 100 m/s
    const result = evaluateTeleportation(
      reference,
      reference.latitude + latOffset,
      reference.longitude,
      new Date(reference.timestamp.getTime() + 5000),
      100,
    );
    expect(result.suspect).toBe(true);
  });
});
