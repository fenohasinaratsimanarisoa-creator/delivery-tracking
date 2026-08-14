import { normalizePagination } from './pagination';

describe('normalizePagination', () => {
  it('garde les valeurs valides', () => {
    expect(normalizePagination(2, 50)).toEqual({ page: 2, limit: 50 });
  });

  it('défaut 1/20 quand absent', () => {
    expect(normalizePagination(undefined, undefined)).toEqual({ page: 1, limit: 20 });
  });

  it('corrige page=0, page négative et page non numérique (évitait skip négatif/NaN → 500)', () => {
    expect(normalizePagination(0, 20).page).toBe(1);
    expect(normalizePagination(-3, 20).page).toBe(1);
    expect(normalizePagination('abc', 20).page).toBe(1);
    expect(normalizePagination('0', 20).page).toBe(1);
  });

  it('corrige limit=0, négative, non numérique (évitait take invalide et totalPages = Infinity)', () => {
    expect(normalizePagination(1, 0).limit).toBe(20);
    expect(normalizePagination(1, -5).limit).toBe(20);
    expect(normalizePagination(1, 'xyz').limit).toBe(20);
  });

  it('borne la limit à maxLimit (100 par défaut)', () => {
    expect(normalizePagination(1, 100000).limit).toBe(100);
    expect(normalizePagination(1, 1000, 200).limit).toBe(200);
  });
});
