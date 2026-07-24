import { CompanyScopeGuard } from './company-scope.guard';
import { ForbiddenException } from '@nestjs/common';

describe('CompanyScopeGuard', () => {
  let guard: CompanyScopeGuard;

  beforeEach(() => {
    guard = new CompanyScopeGuard();
  });

  const makeCtx = (user: any, params: any = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user, params }),
      }),
    }) as any;

  it('should throw when user has no companyId', () => {
    const ctx = makeCtx({ id: 'u1' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should throw when user is missing', () => {
    const ctx = makeCtx(null);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should pass when user has companyId and no param', () => {
    const ctx = makeCtx({ id: 'u1', companyId: 'c1' });
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should throw when param companyId does not match user companyId', () => {
    const ctx = makeCtx({ id: 'u1', companyId: 'c1' }, { companyId: 'c2' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should pass when param companyId matches user companyId', () => {
    const ctx = makeCtx({ id: 'u1', companyId: 'c1' }, { companyId: 'c1' });
    const result = guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('should set request.companyId from user', () => {
    const req: any = { user: { id: 'u1', companyId: 'c1' }, params: {} };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as any;
    guard.canActivate(ctx);
    expect(req.companyId).toBe('c1');
  });
});
