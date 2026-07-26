import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const logger = new Logger('UuidSafetyMiddleware');

/**
 * Prisma middleware that intercepts any query where a field whose name ends
 * with `Id` receives an empty string `''`, converting it to `null` before
 * Prisma attempts to parse it as a UUID.
 *
 * This is a LAST-RESORT safety net. All callers should validate UUIDs at the
 * DTO/service level. This middleware prevents Prisma from crashing with
 * "Inconsistent column data: Error creating UUID" when an empty string
 * slips through.
 *
 * A warning is logged with the model, action, and field name so the source
 * can be traced and fixed.
 */
export async function uuidSafetyMiddleware(
  params: Prisma.MiddlewareParams,
  next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
): Promise<unknown> {
  sanitizeArgs(params.args);

  return next(params);
}

function sanitizeArgs(args: unknown): void {
  if (!args || typeof args !== 'object') return;

  const obj = args as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (typeof value === 'string' && value === '' && isUuidField(key)) {
      logger.warn(
        `Empty string detected on UUID field "${key}" — converting to null. ` +
          `This indicates a caller sent an empty string instead of omitting/using null. ` +
          `Fix the source to prevent this warning. Stack: ${new Error().stack?.split('\n')[3]?.trim() ?? 'N/A'}`,
      );
      obj[key] = null;
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitizeArgs(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        sanitizeArgs(item);
      }
    }
  }
}

/**
 * Returns true for fields commonly used as UUID foreign keys.
 * Matches: id, userId, companyId, driverId, vehicleId, deliveryId, etc.
 */
function isUuidField(fieldName: string): boolean {
  const UUID_FIELDS = new Set([
    'id',
    'userId',
    'companyId',
    'driverId',
    'vehicleId',
    'deliveryId',
    'subscriptionId',
    'planId',
    'geofenceId',
    'zoneId',
    'invitationId',
    'sessionId',
    'webhookId',
    'apiKeyId',
    'notificationId',
    'auditLogId',
    'fuelRecordId',
    'reportId',
    'alertId',
    'roleId',
    'tokenId',
    'deviceId',
    'assignedDriverId',
    'createdById',
    'updatedById',
    'deletedById',
    'parentId',
    'ownerId',
  ]);

  if (UUID_FIELDS.has(fieldName)) return true;

  return fieldName.endsWith('Id');
}
