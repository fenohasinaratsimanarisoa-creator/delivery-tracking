import {
  computeRouteMatchedDistance,
  MATCH_CHUNK_SIZE,
  type MatchBudget,
  type MatchDistanceFn,
  type RouteDistanceFix,
} from './route-distance';
import { haversineDistance, computeFilteredDistance } from './geo.utils';

const T0 = new Date('2026-09-15T06:00:00.000Z').getTime();
const at = (i: number) => new Date(T0 + i * 4000);

/**
 * Trace rectiligne plein nord, `n` points espacés de `stepM` mètres. La vitesse est
 * celle qu'implique l'espacement (stepM / 4 s) : un véhicule qui ROULE. Avec
 * `speed: 0` sur 57 m en 76 s, la trace était indiscernable d'un ARRÊT avec dérive GPS
 * (détection d'arrêt du 2026-09-19) et se faisait — à raison — regrouper en un point.
 */
function straightLine(n: number, stepM: number, accuracy = 8): RouteDistanceFix[] {
  return Array.from({ length: n }, (_, i) => ({
    latitude: (stepM * i) / 111320,
    longitude: 0,
    accuracy,
    speed: Math.max(stepM / 4, 2),
    timestamp: at(i),
  }));
}

describe('computeRouteMatchedDistance', () => {
  it('utilise la distance OSRM (accrochée route) quand le matching réussit avec confiance suffisante', async () => {
    const positions = straightLine(20, 3); // ~57 m de corde brute
    const matchFn: MatchDistanceFn = jest
      .fn()
      .mockResolvedValue({ distance: 250, confidence: 0.95 });
    const km = (await computeRouteMatchedDistance(positions, matchFn)) / 1000;
    // 250 m retournés par OSRM (route réelle, virages) contre ~57 m de corde brute.
    expect(km).toBeCloseTo(0.25, 3);
    expect(matchFn).toHaveBeenCalled();
  });

  it('retombe sur computeFilteredDistance quand OSRM ne renvoie rien (indisponible / NoMatch)', async () => {
    const positions = straightLine(20, 3);
    const matchFn: MatchDistanceFn = jest.fn().mockResolvedValue(null);
    const got = await computeRouteMatchedDistance(positions, matchFn);
    const expected = computeFilteredDistance(positions);
    expect(got).toBeCloseTo(expected, 1);
  });

  it('retombe sur computeFilteredDistance quand la confiance OSRM est quasi nulle (dégénérée)', async () => {
    const positions = straightLine(20, 3);
    const matchFn: MatchDistanceFn = jest
      .fn()
      .mockResolvedValue({ distance: 999999, confidence: 0.01 });
    const got = await computeRouteMatchedDistance(positions, matchFn);
    const expected = computeFilteredDistance(positions);
    expect(got).toBeCloseTo(expected, 1);
    // La distance aberrante à confiance quasi nulle ne doit JAMAIS être retenue.
    expect(got).toBeLessThan(1000);
  });

  // AUDIT SOUS-COMPTAGE CARBURANT 2026-09-15 BIS — trace réelle du 14/09 (moto,
  // odomètre 42 km) : plusieurs morceaux à confiance 0,13-0,30 étaient rejetés
  // par l'ancien seuil (0,5, repris à tort de live-map-match — calibré pour
  // l'affichage temps réel, pas la distance cumulée) alors qu'OSRM y renvoyait
  // une distance cohérente (unique matching, dans la fourchette +15-20 % de la
  // corde brute déjà observée sur les morceaux à haute confiance). Ce seul
  // seuil coûtait ~1,4 km de sous-comptage ce jour-là.
  it('retient désormais la distance OSRM à confiance modérée (0,13 à 0,30) — cas réel du 14/09', async () => {
    const positions = straightLine(20, 3); // ~57 m de corde brute
    const matchFn: MatchDistanceFn = jest
      .fn()
      .mockResolvedValue({ distance: 3345, confidence: 0.128 }); // chunk réel i=869
    const got = await computeRouteMatchedDistance(positions, matchFn);
    expect(got).toBeCloseTo(3345, 0);
  });

  it('retombe sur computeFilteredDistance quand matchFn lève une exception (panne réseau OSRM)', async () => {
    const positions = straightLine(20, 3);
    const matchFn: MatchDistanceFn = jest.fn().mockRejectedValue(new Error('OSRM down'));
    const got = await computeRouteMatchedDistance(positions, matchFn);
    const expected = computeFilteredDistance(positions);
    expect(got).toBeCloseTo(expected, 1);
  });

  it('ne tente PAS OSRM sur un reliquat trop court (< MATCH_MIN_FIXES) — repli direct', async () => {
    const positions = straightLine(2, 3);
    const matchFn: MatchDistanceFn = jest
      .fn()
      .mockResolvedValue({ distance: 500, confidence: 0.9 });
    await computeRouteMatchedDistance(positions, matchFn);
    expect(matchFn).not.toHaveBeenCalled();
  });

  it('découpe une longue trace en plusieurs morceaux avec chevauchement d’1 point (pas de trou ni double-compte)', async () => {
    const n = MATCH_CHUNK_SIZE * 2 + 10;
    const positions = straightLine(n, 3);
    const seenChunkSizes: number[] = [];
    const matchFn: MatchDistanceFn = jest.fn().mockImplementation(async (coords: unknown[]) => {
      seenChunkSizes.push(coords.length);
      return { distance: (coords.length - 1) * 3, confidence: 0.9 };
    });
    await computeRouteMatchedDistance(positions, matchFn);
    expect(matchFn).toHaveBeenCalledTimes(3);
    expect(seenChunkSizes[0]).toBe(MATCH_CHUNK_SIZE);
    // Chaque morceau suivant commence au DERNIER point du précédent (chevauchement).
    const totalPointsCovered =
      seenChunkSizes.reduce((a, b) => a + b, 0) - (seenChunkSizes.length - 1);
    expect(totalPointsCovered).toBe(n);
  });

  it('applique collapseStationaryWindows en amont : un arrêt de plusieurs heures devient un point avant découpage', async () => {
    // 5 points d'un trajet, puis un arrêt dense de 400 s (>= STATIONARY_MIN_DURATION_S)
    // dans un rayon de 5 m, puis 5 points de trajet.
    const trip1 = straightLine(5, 20); // 0..4
    const stopStart = trip1.length;
    const stop = Array.from({ length: 30 }, (_, i) => ({
      latitude: trip1[trip1.length - 1].latitude + (Math.random() * 2 - 1) / 111320,
      longitude: 0,
      accuracy: 8,
      speed: 0,
      timestamp: new Date(at(stopStart).getTime() + i * 15000), // 15s d'intervalle sur 435s
    }));
    const trip2 = Array.from({ length: 5 }, (_, i) => ({
      latitude: trip1[trip1.length - 1].latitude + (20 * (i + 1)) / 111320,
      longitude: 0,
      accuracy: 8,
      speed: 0,
      timestamp: new Date(stop[stop.length - 1].timestamp.getTime() + (i + 1) * 4000),
    }));
    const positions = [...trip1, ...stop, ...trip2];
    let seenPointCount = 0;
    const matchFn: MatchDistanceFn = jest.fn().mockImplementation(async (coords: unknown[]) => {
      seenPointCount = coords.length;
      return { distance: 200, confidence: 0.9 };
    });
    await computeRouteMatchedDistance(positions, matchFn);
    // Sans collapse : 5 + 30 + 5 = 40 points envoyés. Avec collapse, l'arrêt de
    // 30 points devient 1 seul point représentatif.
    expect(seenPointCount).toBeLessThan(positions.length);
    expect(seenPointCount).toBeLessThanOrEqual(11);
  });

  it('repli intégral sur computeFilteredDistance si les timestamps sont absents (jamais de crash)', async () => {
    const positions: RouteDistanceFix[] = [
      { latitude: 0, longitude: 0, accuracy: 8, speed: 5 },
      { latitude: 0.0004, longitude: 0, accuracy: 8, speed: 5 }, // ~44 m, vitesse fiable
    ];
    const matchFn: MatchDistanceFn = jest.fn();
    const got = await computeRouteMatchedDistance(positions, matchFn);
    expect(matchFn).not.toHaveBeenCalled();
    expect(got).toBeCloseTo(computeFilteredDistance(positions), 1);
    expect(got).toBeGreaterThan(0);
  });

  it('non-régression : proche de haversine cumulé pour un trajet propre quand OSRM confirme quasi la même distance', async () => {
    const positions = straightLine(50, 20); // 20 m/pas, cohérent avec une progression réelle
    let naive = 0;
    for (let i = 1; i < positions.length; i++) {
      naive += haversineDistance(
        positions[i - 1].latitude,
        positions[i - 1].longitude,
        positions[i].latitude,
        positions[i].longitude,
      );
    }
    const matchFn: MatchDistanceFn = jest
      .fn()
      .mockResolvedValue({ distance: naive, confidence: 0.9 });
    const got = await computeRouteMatchedDistance(positions, matchFn);
    expect(got).toBeCloseTo(naive, 0);
  });

  // AUDIT SOUS-COMPTAGE CARBURANT 2026-09-15 — extension scanVehicleTrack
  // (crossCheckFuelLogWithGps) : le budget OSRM doit être PARTAGEABLE entre
  // plusieurs appels successifs (une page = un appel), pour borner le total
  // réel d'appels OSRM sur toute une fenêtre paginée, pas seulement par page.
  describe('MatchBudget partagé entre plusieurs appels (pagination scanVehicleTrack)', () => {
    it('épuise le budget PARTAGÉ à travers plusieurs appels successifs', async () => {
      const budget: MatchBudget = { remaining: 2 };
      const matchFn: MatchDistanceFn = jest
        .fn()
        .mockResolvedValue({ distance: 100, confidence: 0.9 });

      // 1er appel : 2 morceaux (utilise tout le budget de 2).
      const positions1 = straightLine(MATCH_CHUNK_SIZE + 10, 3);
      await computeRouteMatchedDistance(positions1, matchFn, budget);
      expect(matchFn).toHaveBeenCalledTimes(2);
      expect(budget.remaining).toBe(0);

      // 2e appel (page suivante) : budget épuisé → repli intégral sur
      // computeFilteredDistance, AUCUN appel OSRM supplémentaire.
      const positions2 = straightLine(MATCH_CHUNK_SIZE + 10, 3);
      const before = (matchFn as jest.Mock).mock.calls.length;
      await computeRouteMatchedDistance(positions2, matchFn, budget);
      expect((matchFn as jest.Mock).mock.calls.length).toBe(before);
    });

    it('sans budget explicite (appelant unique, ex. rapport journalier) : comportement inchangé', async () => {
      const positions = straightLine(MATCH_CHUNK_SIZE * 2 + 10, 3);
      const matchFn: MatchDistanceFn = jest
        .fn()
        .mockResolvedValue({ distance: 100, confidence: 0.9 });
      await computeRouteMatchedDistance(positions, matchFn);
      expect(matchFn).toHaveBeenCalledTimes(3);
    });
  });
});
