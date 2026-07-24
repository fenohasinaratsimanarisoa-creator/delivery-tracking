import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    req.requestId = requestId;
    req.log = req.log?.child({
      requestId,
      method: req.method,
      url: req.originalUrl || req.url,
    });

    const user = req.user;
    if (user) {
      const ctx = {
        userId: user.type === 'platform_admin' ? undefined : user.id,
        companyId: user.companyId,
        adminId: user.type === 'platform_admin' ? user.id : undefined,
        role: user.role,
      };
      req.log = req.log?.child(ctx);
    }

    const now = Date.now();
    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - now;
        req.log?.info(
          { statusCode: context.switchToHttp().getResponse().statusCode, durationMs: ms },
          'request completed',
        );
      }),
    );
  }
}
