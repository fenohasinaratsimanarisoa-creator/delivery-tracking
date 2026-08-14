// Normalise page/limit reçus en query string. Un paramètre mal formé
// (page=0, page=abc, limit=-5, limit=10^9) provoquait un skip négatif/NaN ou un
// totalPages = Infinity → PrismaClientValidationError → 500. Ici : bornes sûres.
export interface Pagination {
  page: number;
  limit: number;
}

export function normalizePagination(page?: unknown, limit?: unknown, maxLimit = 100): Pagination {
  const rawPage = typeof page === 'number' ? page : parseInt(String(page ?? '1'), 10);
  const rawLimit = typeof limit === 'number' ? limit : parseInt(String(limit ?? '20'), 10);

  const p = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let l = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 20;
  if (l > maxLimit) l = maxLimit;

  return { page: p, limit: l };
}
