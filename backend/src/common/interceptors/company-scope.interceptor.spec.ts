import { Observable, of } from 'rxjs';
import { CompanyScopedContext } from '../tenant/company-scoped-context';
import { CompanyScopeInterceptor } from './company-scope.interceptor';

describe('CompanyScopeInterceptor', () => {
  let interceptor: CompanyScopeInterceptor;

  beforeEach(() => {
    interceptor = new CompanyScopeInterceptor();
  });

  it('sets company context from request.companyId for HTTP requests', (done) => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ companyId: 'company-a', user: { companyId: 'company-a' } }),
      }),
    } as any;

    const next = { handle: () => of('result') };

    interceptor.intercept(context, next).subscribe({
      next: (val) => {
        expect(val).toBe('result');
        expect(CompanyScopedContext.get()).toBe('company-a');
        done();
      },
    });
  });

  it('bypasses when no companyId is available', (done) => {
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ user: {} }),
      }),
    } as any;

    const next = { handle: () => of('result') };

    interceptor.intercept(context, next).subscribe({
      next: (val) => {
        expect(val).toBe('result');
        expect(CompanyScopedContext.get()).toBeUndefined();
        done();
      },
    });
  });
});
