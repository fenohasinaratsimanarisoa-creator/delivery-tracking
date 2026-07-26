import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import * as Sentry from '@sentry/node';
import { AlertService } from '../alerting/alert.service';

const PRISMA_CODE_MAP: Record<string, { status: number; message: string }> = {
  P2000: { status: HttpStatus.BAD_REQUEST, message: 'Valeur trop longue pour la colonne' },
  P2002: { status: HttpStatus.CONFLICT, message: 'Cette ressource existe déjà' },
  P2003: { status: HttpStatus.BAD_REQUEST, message: 'Référence invalide : ressource introuvable' },
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Ressource introuvable' },
};

function getPrismaFieldName(
  exception: Prisma.PrismaClientKnownRequestError,
): string | undefined {
  const meta = exception.meta as Record<string, unknown> | undefined;
  if (meta?.target && Array.isArray(meta.target)) {
    return (meta.target as string[]).join(', ');
  }
  if (meta?.field_name && typeof meta.field_name === 'string') {
    return meta.field_name;
  }
  return undefined;
}

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

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapping = PRISMA_CODE_MAP[exception.code];
      if (mapping) {
        status = mapping.status;
        const field = getPrismaFieldName(exception);
        if (exception.code === 'P2002' && field) {
          message = `${mapping.message} : ${field}`;
        } else if (exception.code === 'P2003' && field) {
          message = `Référence invalide : ${field} introuvable`;
        } else {
          message = mapping.message;
        }
      } else {
        message = 'Erreur interne de la base de données';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Données invalides envoyées à la base de données';
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
      message = 'Erreur de connexion à la base de données';
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      message = 'Erreur interne du moteur de base de données';
    } else if (exception instanceof HttpException) {
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
