import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const route = req.route?.path || req.originalUrl || req.url;

    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const statusCode = context.switchToHttp().getResponse().statusCode;
        const ms = Date.now() - start;
        this.metrics.httpRequestDuration.observe(
          { method, route, status_code: String(statusCode) },
          ms,
        );
        this.metrics.httpRequestTotal.inc({ method, route, status_code: String(statusCode) });
        if (statusCode >= 500) {
          this.metrics.httpRequestErrors.inc({ method, route });
        }
      }),
      catchError((err) => {
        const statusCode = err?.status || 500;
        const ms = Date.now() - start;
        this.metrics.httpRequestDuration.observe(
          { method, route, status_code: String(statusCode) },
          ms,
        );
        this.metrics.httpRequestTotal.inc({ method, route, status_code: String(statusCode) });
        if (statusCode >= 500) {
          this.metrics.httpRequestErrors.inc({ method, route });
        }
        return throwError(() => err);
      }),
    );
  }
}
