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

  const { action, args } = params;

  if (action === 'create' && args?.data && !args.data.companyId) {
    args.data.companyId = companyId;
  }

  if (action === 'createMany' && args?.data) {
    const data = args.data as Record<string, unknown>[];
    for (const item of data) {
      if (!item.companyId) item.companyId = companyId;
    }
  }

  if (args?.where) {
    args.where = { ...args.where, companyId };
  }

  return next(params);
}
