import { isOnTime } from './delivery-timing';

describe('isOnTime', () => {
  it('vrai si pas de date prévue (rien à comparer)', () => {
    expect(isOnTime(new Date('2026-08-29T13:22:00Z'), null)).toBe(true);
  });

  it('faux si jamais terminée mais une date était prévue', () => {
    expect(isOnTime(null, new Date('2026-08-29T00:00:00Z'))).toBe(false);
  });

  it('vrai si terminée le jour prévu, même en fin de journée (régression 2026-09-06)', () => {
    expect(isOnTime(new Date('2026-08-29T13:22:58Z'), new Date('2026-08-29T00:00:00Z'))).toBe(true);
    expect(isOnTime(new Date('2026-08-29T23:59:59Z'), new Date('2026-08-29T00:00:00Z'))).toBe(true);
  });

  it('vrai si terminée exactement à minuit le jour prévu', () => {
    expect(isOnTime(new Date('2026-08-29T00:00:00.000Z'), new Date('2026-08-29T00:00:00Z'))).toBe(
      true,
    );
  });

  it('faux si terminée le lendemain ou plus tard', () => {
    expect(isOnTime(new Date('2026-08-30T00:00:00.001Z'), new Date('2026-08-29T00:00:00Z'))).toBe(
      false,
    );
    expect(isOnTime(new Date('2026-09-06T17:03:31Z'), new Date('2026-09-05T00:00:00Z'))).toBe(
      false,
    );
  });
});
