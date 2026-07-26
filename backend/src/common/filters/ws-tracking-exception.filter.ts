import {
  Catch,
  ArgumentsHost,
  Inject,
  Logger,
} from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import * as Sentry from '@sentry/node';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { AlertService } from '../alerting/alert.service';

/**
 * WebSocket exception filter for the Tracking gateway.
 *
 * Captures errors that occur inside WebSocket message handlers (not HTTP),
 * which would otherwise be silently swallowed by NestJS's default
 * WsExceptionsHandler — as observed in production with the UUID crash
 * that went undetected for hours.
 */
@Catch()
export class WsTrackingExceptionFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger(WsTrackingExceptionFilter.name);

  constructor(@Inject(AlertService) private alertService?: AlertService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const data = host.switchToWs().getData();
    const user = client.data?.user;

    let errorMessage = 'Internal error';
    let errorName = 'UnknownError';

    if (exception instanceof Error) {
      errorMessage = exception.message;
      errorName = exception.name;
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      errorMessage = exception.message;
      errorName = 'PrismaError';
    }

    this.logger.error(
      `[WS ERROR] ${errorName}: ${errorMessage.substring(0, 200)} ` +
        `user=${user?.id ?? 'N/A'} company=${user?.companyId ?? 'N/A'}`,
    );

    const sentryId = Sentry.captureException(exception, {
      tags: {
        transport: 'websocket',
        userId: user?.id,
        companyId: user?.companyId,
      },
      user: user
        ? {
            id: user.id,
            companyId: user.companyId,
            role: user.role,
          }
        : undefined,
      extra: {
        eventData: typeof data === 'object' ? JSON.stringify(data).substring(0, 500) : String(data),
      },
    });

    if (this.alertService && process.env.ALERT_ON_ERROR === 'true') {
      const errorKey = `ws:${errorName}`;
      this.alertService
        .trackRepeatedError(
          errorKey,
          exception instanceof Error ? exception : new Error(String(exception)),
          {
            transport: 'websocket',
            userId: user?.id,
            companyId: user?.companyId,
            sentryId,
          },
        )
        .catch(() => {});
    }

    client.emit('error', { message: 'Internal server error' });
  }
}
