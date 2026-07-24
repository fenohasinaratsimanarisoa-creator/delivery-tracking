import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import * as Sentry from '@sentry/node';
import { AlertService } from '../alerting/alert.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(AlertService) private alertService?: AlertService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<
      Request & { requestId?: string; log?: { error: (obj: object) => void } }
    >();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | object = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        message = (res as Record<string, unknown>).message || res;
      }
    }

    if (status >= 500) {
      if (request.log) {
        request.log.error({ err: exception, statusCode: status, url: request.url });
      }

      const sentryId = Sentry.captureException(exception, {
        tags: { statusCode: String(status), requestId: request.requestId, url: request.url },
        user: (request as any).user
          ? {
              id: (request as any).user.id,
              ip_address:
                (request as any).headers?.['x-forwarded-for'] ||
                (request as any).socket?.remoteAddress,
            }
          : undefined,
      });

      if (this.alertService && process.env.ALERT_ON_ERROR === 'true') {
        this.alertService.sendCriticalError(
          exception instanceof Error ? exception : new Error(String(exception)),
          {
            requestId: request.requestId,
            url: request.url,
            sentryId,
          },
        );
      }
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
      ...(status >= 500 && request.requestId ? { requestId: request.requestId } : {}),
    });
  }
}
