import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePositionDto } from './update-position.dto';

const VALID_BASE = {
  latitude: -18.8792,
  longitude: 47.5079,
  accuracy: 10,
  vehicleId: '22222222-2222-4222-8222-222222222222',
};

async function validateTimestamp(timestamp: string) {
  const instance = plainToInstance(UpdatePositionDto, { ...VALID_BASE, timestamp });
  return validate(instance, { whitelist: true, skipMissingProperties: false });
}

function transformTimestamp(timestamp: string): string {
  return plainToInstance(UpdatePositionDto, { ...VALID_BASE, timestamp }).timestamp;
}

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit GPS 2026-08-27, MOYENNE) : @IsDateString()
// seul acceptait n'importe quelle date ISO valide, y compris 1970 ou 2099 —
// une horloge appareil mal réglée ou une file locale corrompue pouvait donc
// injecter un timestamp aberrant en base, faussant durablement vitesse/ETA/
// détection de téléportation (calculs dérivés d'un écart entre positions
// consécutives). @IsPlausibleTimestamp() borne désormais la fenêtre acceptée.
// =============================================================================
describe('UpdatePositionDto — plausibilité du timestamp (audit GPS 2026-08-27)', () => {
  it('accepte un timestamp au moment présent', async () => {
    const errors = await validateTimestamp(new Date().toISOString());
    expect(errors).toHaveLength(0);
  });

  it('accepte un timestamp légèrement dans le futur (dérive horloge raisonnable, < 5 min)', async () => {
    const errors = await validateTimestamp(new Date(Date.now() + 2 * 60 * 1000).toISOString());
    expect(errors).toHaveLength(0);
  });

  it('accepte un timestamp de quelques jours dans le passé (rattrapage file locale)', async () => {
    const errors = await validateTimestamp(
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(errors).toHaveLength(0);
  });

  // CHANGEMENT DE COMPORTEMENT (audit GPS parité §3.3) : une horloge appareil qui
  // AVANCE de plus de 5 min n'est plus REJETÉE (perte de la position) mais RECADRÉE
  // sur l'heure serveur — parité avec le pont Traccar, qui conserve toujours le point.
  it('RECADRE un timestamp loin dans le futur (> 5 min) sur l’heure serveur, sans rejet', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const errors = await validateTimestamp(future);
    expect(errors).toHaveLength(0);

    const clamped = transformTimestamp(future);
    expect(clamped).not.toBe(future);
    expect(Math.abs(Date.parse(clamped) - Date.now())).toBeLessThan(5000);
  });

  it('ne touche PAS à un timestamp présent ou légèrement futur (< 5 min)', () => {
    const now = new Date().toISOString();
    expect(transformTimestamp(now)).toBe(now);
    const soon = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    expect(transformTimestamp(soon)).toBe(soon);
  });

  it('REJETTE un timestamp loin dans le passé (> 30 jours — file locale corrompue)', async () => {
    const errors = await validateTimestamp(
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleTimestamp');
  });

  it('REJETTE une date epoch aberrante (1970) — cas réel de bug natif', async () => {
    const errors = await validateTimestamp(new Date(0).toISOString());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleTimestamp');
  });
});
