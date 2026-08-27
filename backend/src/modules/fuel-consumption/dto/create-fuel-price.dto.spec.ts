import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFuelPriceDto } from './create-fuel-price.dto';

const VALID_BASE = {
  fuelType: 'diesel',
  pricePerLiter: 5000,
  effectiveFrom: '2026-08-01',
};

async function validateDto(overrides: Partial<typeof VALID_BASE>) {
  const instance = plainToInstance(CreateFuelPriceDto, { ...VALID_BASE, ...overrides });
  return validate(instance, { whitelist: true, skipMissingProperties: false });
}

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit carburant 2026-08-27, HAUTE #3) : pricePerLiter
// n'avait pas de borne haute, contrairement à UpdateDefaultFuelPricesDto (plafond
// 50 000 Ar/L). Une erreur de saisie (un zéro de trop) sur ce point d'entrée —
// le plus consulté, utilisé pour TOUS les calculs de coût réels — n'était pas
// protégée.
// =============================================================================
describe('CreateFuelPriceDto (audit carburant 2026-08-27)', () => {
  it('accepte un payload valide', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('REJETTE un prix au-delà du plafond marché (50 000 Ar/L)', async () => {
    const errors = await validateDto({ pricePerLiter: 60000 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'pricePerLiter')).toBe(true);
  });

  it('accepte un prix au plafond exact (50 000)', async () => {
    const errors = await validateDto({ pricePerLiter: 50000 });
    expect(errors).toHaveLength(0);
  });

  it('rejette toujours un prix négatif (déjà couvert avant l\'audit, non-régression)', async () => {
    const errors = await validateDto({ pricePerLiter: -1 });
    expect(errors.length).toBeGreaterThan(0);
  });
});
