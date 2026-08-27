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
    const errors = await validateTimestamp(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString());
    expect(errors).toHaveLength(0);
  });

  it('REJETTE un timestamp loin dans le futur (> 5 min — horloge dérèglée ou falsifiée)', async () => {
    const errors = await validateTimestamp(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleTimestamp');
  });

  it('REJETTE un timestamp loin dans le passé (> 30 jours — file locale corrompue)', async () => {
    const errors = await validateTimestamp(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleTimestamp');
  });

  it('REJETTE une date epoch aberrante (1970) — cas réel de bug natif', async () => {
    const errors = await validateTimestamp(new Date(0).toISOString());
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleTimestamp');
  });
});
