import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFuelLogDto } from './create-fuel-log.dto';

const VALID_BASE = {
  liters: 40,
  kilometers: 500,
  cost: 200000,
  fillDate: new Date().toISOString(),
  vehicleId: '22222222-2222-4222-8222-222222222222',
};

async function validateDto(overrides: Partial<typeof VALID_BASE & { notes?: string }>) {
  const instance = plainToInstance(CreateFuelLogDto, { ...VALID_BASE, ...overrides });
  return validate(instance, { whitelist: true, skipMissingProperties: false });
}

// =============================================================================
// RÉGRESSIONS COUVERTES ICI (audit carburant 2026-08-27)
// =============================================================================
describe('CreateFuelLogDto (audit carburant 2026-08-27)', () => {
  it('accepte un payload valide', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('MOYENNE #10 : REJETTE liters = 0 (un "plein" de 0 litre est incohérent)', async () => {
    const errors = await validateDto({ liters: 0 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'liters')).toBe(true);
  });

  it('accepte liters > 0', async () => {
    const errors = await validateDto({ liters: 0.5 });
    expect(errors).toHaveLength(0);
  });

  it('HAUTE #4 : REJETTE une fillDate loin dans le futur (> 1 jour)', async () => {
    const errors = await validateDto({
      fillDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleFuelDate');
  });

  it('HAUTE #4 : REJETTE une fillDate aberrante (epoch 1970)', async () => {
    const errors = await validateDto({ fillDate: new Date(0).toISOString() });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isPlausibleFuelDate');
  });

  it('accepte une fillDate de plusieurs mois dans le passé (saisie différée légitime)', async () => {
    const errors = await validateDto({
      fillDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(errors).toHaveLength(0);
  });

  it('FAIBLE #12 : REJETTE un vehicleId qui n\'est pas un UUID', async () => {
    const errors = await validateDto({ vehicleId: 'not-a-uuid' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'vehicleId')).toBe(true);
  });

  it('FAIBLE #11 : REJETTE des notes trop longues (> 2000 caractères)', async () => {
    const errors = await validateDto({ notes: 'x'.repeat(2001) });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'notes')).toBe(true);
  });

  it('accepte des notes de longueur raisonnable', async () => {
    const errors = await validateDto({ notes: 'Plein complet, station Jovena' });
    expect(errors).toHaveLength(0);
  });
});
