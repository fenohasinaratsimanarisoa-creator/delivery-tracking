import { CompanyScopedContext } from '../tenant/company-scoped-context';
import { tenantScopeMiddleware } from './tenant-scope.middleware';

describe('tenantScopeMiddleware', () => {
  const nextSpy = jest.fn().mockImplementation((params) => Promise.resolve(params));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('injects companyId into where clause when context is set', async () => {
    const params = {
      model: 'Vehicle',
      action: 'findMany',
      args: { where: { isActive: true } },
    };

    await CompanyScopedContext.run('company-1', () =>
      tenantScopeMiddleware(params as any, nextSpy),
    );

    expect(nextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { where: { isActive: true, companyId: 'company-1' } },
      }),
    );
  });

  it('injects companyId into create data', async () => {
    const params = {
      model: 'Delivery',
      action: 'create',
      args: { data: { title: 'Test' } },
    };

    await CompanyScopedContext.run('company-1', () =>
      tenantScopeMiddleware(params as any, nextSpy),
    );

    expect(nextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { data: { title: 'Test', companyId: 'company-1' } },
      }),
    );
  });

  it('bypasses when no context is set', async () => {
    const params = {
      model: 'Vehicle',
      action: 'findMany',
      args: { where: { isActive: true } },
    };

    await tenantScopeMiddleware(params as any, nextSpy);

    expect(nextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { where: { isActive: true } },
      }),
    );
    expect(nextSpy.mock.calls[0][0].args.where.companyId).toBeUndefined();
  });

  it('bypasses for non-tenant-scoped models', async () => {
    const params = {
      model: 'BillingPlan',
      action: 'findMany',
      args: { where: { isActive: true } },
    };

    await CompanyScopedContext.run('company-1', () =>
      tenantScopeMiddleware(params as any, nextSpy),
    );

    expect(nextSpy.mock.calls[0][0].args.where.companyId).toBeUndefined();
  });

  it('bypasses for platform admin (null context)', async () => {
    const params = {
      model: 'Vehicle',
      action: 'findMany',
      args: { where: { isActive: true } },
    };

    await CompanyScopedContext.run(null, () =>
      tenantScopeMiddleware(params as any, nextSpy),
    );

    expect(nextSpy.mock.calls[0][0].args.where.companyId).toBeUndefined();
  });
});
