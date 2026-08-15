import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { predictPosition, maxDeadReckonTime } from './deadReckoning';

// =============================================================================
// FIDÉLITÉ DU TRAJET (Partie 2, point 1) — dead reckoning = AFFICHAGE UNIQUEMENT.
//
// predictPosition() extrapole une position entre deux fixes GPS reçus : c'est une
// donnée INVENTÉE (calculée, jamais mesurée). Elle sert UNIQUEMENT à lisser la
// carte temps réel (RealTimeMap) entre deux positions réelles. Elle ne doit
// JAMAIS être envoyée au backend ni enregistrée en base — le trajet officiel
// d'une livraison ne contient que des fixes GPS réels.
// Ces tests verrouillent le contrat : fonction pure + seul RealTimeMap l'importe.
// =============================================================================

describe('deadReckoning — contrat "affichage uniquement"', () => {
  it('predictPosition est une fonction pure : mêmes entrées → mêmes sorties (aucun effet de bord, aucune I/O)', () => {
    const state = { lat: -18.8792, lng: 47.5079, speed: 10, heading: 90, timestamp: 1000 };
    const a = predictPosition(state, 2000);
    const b = predictPosition(state, 2000);
    expect(a).toEqual(b);
  });

  it('extrapole vers l\'AVANT selon cap et vitesse (fonction d\'affichage)', () => {
    // Cap 90° (est) → la longitude augmente, la latitude reste stable.
    const state = { lat: 0, lng: 0, speed: 10, heading: 90, timestamp: 1000 };
    const predicted = predictPosition(state, 2000); // 1 s d'écart → 10 m vers l'est
    expect(predicted.lat).toBeCloseTo(0, 5);
    expect(predicted.lng).toBeGreaterThan(0);
    // ~10 m à l'équateur ≈ 8.98e-5 degrés de longitude.
    expect(predicted.lng).toBeCloseTo(10 / (111320 * Math.cos(0)), 5);
  });

  it('retourne la dernière position réelle sans extrapolation si speed <= 0 ou temps non écoulé', () => {
    const state = { lat: -18.8792, lng: 47.5079, speed: 0, heading: 90, timestamp: 1000 };
    expect(predictPosition(state, 5000)).toEqual({ lat: state.lat, lng: state.lng });
    expect(predictPosition({ ...state, speed: 10 }, 1000)).toEqual({
      lat: state.lat,
      lng: state.lng,
    });
  });

  it('maxDeadReckonTime borne l\'horizon d\'extrapolation (quelques secondes, jamais une durée de coupure)', () => {
    // À toute vitesse, l'extrapolation est plafonnée à 5 s — un trou de 5 min de
    // coupure n'est JAMAIS comblé par une trajectoire inventée sur la durée.
    expect(maxDeadReckonTime(1)).toBeGreaterThanOrEqual(1000);
    expect(maxDeadReckonTime(100)).toBe(5000);
    expect(maxDeadReckonTime(0)).toBe(0);
    expect(maxDeadReckonTime(100)).toBeLessThanOrEqual(5000);
  });

  it('GARDE ANTI-RÉGRESSION : seul RealTimeMap (affichage) importe deadReckoning — aucun chemin d\'envoi', () => {
    // Parcourt l'arbre src/ et vérifie que le seul import de deadReckoning est
    // RealTimeMap.tsx (rendu carte). Si un hook/service d'envoi l'importait
    // (useDriverTracking, offlineQueue, TrackingContext…), le test échoue :
    // ce serait une position inventée injectée dans le trajet officiel.
    const srcRoot = join(__dirname, '..', '..', '..', 'src');
    const walk = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) files.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.spec\./.test(e.name)) files.push(full);
      }
      return files;
    };

    const importers = walk(srcRoot)
      .filter((f) => {
        const content = readFileSync(f, 'utf8');
        return (
          content.includes('services/tracking/deadReckoning') ||
          content.includes('tracking/deadReckoning') ||
          content.includes("from './deadReckoning'") ||
          content.includes('from "../deadReckoning"') ||
          content.includes('from "../../deadReckoning"')
        );
      })
      .map((f) => f.replace(srcRoot, 'src'));

    expect(importers).toEqual(['src/features/map/RealTimeMap.tsx']);
  });
});
