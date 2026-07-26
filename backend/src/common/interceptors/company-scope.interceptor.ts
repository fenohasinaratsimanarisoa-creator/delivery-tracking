import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { CompanyScopedContext } from '../tenant/company-scoped-context';

@Injectable()
export class CompanyScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType();
    let companyId: string | null | undefined;

    if (type === 'http') {
      const request = context.switchToHttp().getRequest();
      companyId = request.companyId || request.user?.companyId;
    } else if (type === 'ws') {
      const client = context.switchToWs().getClient();
      companyId = client.data?.user?.companyId;
    }

    if (!companyId) return next.handle();

    return new Observable((subscriber) => {
      const sub = CompanyScopedContext.run(companyId, () => next.handle().subscribe(subscriber));
      return () => sub.unsubscribe();
    });
  }
}
