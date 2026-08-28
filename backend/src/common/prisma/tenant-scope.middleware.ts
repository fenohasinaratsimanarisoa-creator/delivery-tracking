import type { Prisma } from '@prisma/client';
import { CompanyScopedContext } from '../tenant/company-scoped-context';

const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Vehicle',
  'Driver',
  'Delivery',
  'Geofence',
  'Notification',
  'CompanySettings',
  'CompanyFuelSettings',
  'FuelLog',
  'FuelPriceHistory',
  'MaintenanceRecord',
  'DailyFuelReport',
  'Invitation',
  'AuditLog',
  'ApiKey',
  'Webhook',
  'Invoice',
  'Subscription',
  'UsageRecord',
]);

export async function tenantScopeMiddleware(
  params: Prisma.MiddlewareParams,
  next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
): Promise<unknown> {
  const companyId = CompanyScopedContext.get();
  if (!companyId || !params.model || !TENANT_SCOPED_MODELS.has(params.model)) {
    return next(params);
  }

  const { action } = params;
  // params.args peut être totalement absent (ex. `prisma.model.findMany()` sans
  // argument) : on le matérialise pour pouvoir y injecter le filtre tenant.
  if (!params.args) params.args = {};
  const args = params.args;

  if (action === 'create' && args?.data && !args.data.companyId) {
    args.data.companyId = companyId;
  }

  if (action === 'createMany' && args?.data) {
    const data = args.data as Record<string, unknown>[];
    for (const item of data) {
      if (!item.companyId) item.companyId = companyId;
    }
  }

  // Actions de lecture / mutation de masse : le filtre tenant DOIT s'appliquer
  // même quand l'appelant n'a fourni AUCUN `where` (ex. `findMany()`,
  // `count()`, `updateMany({ data })`). Avant, `if (args?.where)` sautait
  // silencieusement l'injection dans ce cas → le « dernier rempart » ne
  // rattrapait plus un oubli de scoping applicatif (fuite cross-tenant totale).
  const SCOPED_BULK_ACTIONS = new Set([
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'count',
    'aggregate',
    'groupBy',
    'updateMany',
    'deleteMany',
  ]);

  if (args.where) {
    args.where = { ...args.where, companyId };
  } else if (SCOPED_BULK_ACTIONS.has(action)) {
    args.where = { companyId };
  }

  return next(params);
}
