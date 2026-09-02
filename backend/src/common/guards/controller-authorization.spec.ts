/**
 * Contrat d'autorisation des contrôleurs — verrou anti-régression.
 *
 * Ce test lit par réflexion les métadonnées `@UseGuards(...)` / `@Roles(...)`
 * réellement posées sur chaque contrôleur (classe + méthodes sensibles) et les
 * compare à une table explicite. But : rendre IMPOSSIBLE de retirer
 * silencieusement un guard (JwtAuthGuard, CompanyScopeGuard, RolesGuard,
 * SuperAdminGuard) ou d'élargir un `@Roles` lors d'un refactor — la revue de
 * code peut laisser passer une ligne supprimée, pas ce test.
 *
 * Il ne démarre pas Nest : import direct des classes + `Reflect.getMetadata`.
 */
import 'reflect-metadata';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

import { WebhooksController } from '../../modules/webhooks/webhooks.controller';
import { ApiKeysController } from '../../modules/api-keys/api-keys.controller';
import { BillingController } from '../../modules/billing/billing.controller';
import { UsersController } from '../../modules/users/users.controller';
import { VehiclesController } from '../../modules/vehicles/vehicles.controller';
import { DriversController } from '../../modules/drivers/drivers.controller';
import { DeliveriesController } from '../../modules/deliveries/deliveries.controller';
import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { AuditLogController } from '../../modules/audit-log/audit-log.controller';
import { ReportsController } from '../../modules/reports/reports.controller';
import { PlatformAdminController } from '../../modules/platform-admin/platform-admin.controller';

const GUARDS_METADATA = '__guards__';

function classGuardNames(target: unknown): string[] {
  const guards = Reflect.getMetadata(GUARDS_METADATA, target as object) as
    Array<{ name: string }> | undefined;
  return (guards ?? []).map((g) => g?.name ?? String(g));
}

function methodFn(proto: object, method: string): object {
  return (proto as unknown as Record<string, object>)[method];
}

function methodGuardNames(proto: object, method: string): string[] {
  const guards = Reflect.getMetadata(GUARDS_METADATA, methodFn(proto, method)) as
    Array<{ name: string }> | undefined;
  return (guards ?? []).map((g) => g?.name ?? String(g));
}

function classRoles(target: unknown): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, target as object) as string[] | undefined;
}

function methodRoles(proto: object, method: string): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, methodFn(proto, method)) as string[] | undefined;
}

function methodIsPublic(proto: object, method: string): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, methodFn(proto, method)) === true;
}

describe('Contrat d’autorisation des contrôleurs', () => {
  describe('guards de classe', () => {
    const cases: Array<{ name: string; ctrl: unknown; guards: string[]; roles?: string[] }> = [
      {
        name: 'WebhooksController',
        ctrl: WebhooksController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard', 'RolesGuard'],
        roles: ['admin'],
      },
      {
        name: 'ApiKeysController',
        ctrl: ApiKeysController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard', 'RolesGuard'],
        roles: ['admin'],
      },
      {
        name: 'BillingController',
        ctrl: BillingController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'UsersController',
        ctrl: UsersController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'VehiclesController',
        ctrl: VehiclesController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'DriversController',
        ctrl: DriversController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'DeliveriesController',
        ctrl: DeliveriesController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'NotificationsController',
        ctrl: NotificationsController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'AuditLogController',
        ctrl: AuditLogController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard'],
      },
      {
        name: 'ReportsController',
        ctrl: ReportsController,
        guards: ['JwtAuthGuard', 'CompanyScopeGuard', 'RolesGuard'],
        roles: ['admin', 'dispatcher'],
      },
    ];

    it.each(cases)('$name porte $guards', ({ ctrl, guards, roles }) => {
      const applied = classGuardNames(ctrl);
      for (const g of guards) expect(applied).toContain(g);
      // JwtAuthGuard en premier : l'auth doit passer avant tout contrôle plus fin.
      expect(applied[0]).toBe('JwtAuthGuard');
      if (roles) expect(classRoles(ctrl)).toEqual(roles);
    });

    it('AuditLogController n’expose que de la lecture (aucune méthode d’écriture)', () => {
      const proto = AuditLogController.prototype;
      const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');
      // Un contrôleur d’audit-log qui exposerait create/update/delete serait une
      // régression grave (falsification de piste d’audit).
      for (const m of methods) {
        expect(m).not.toMatch(/^(create|update|delete|remove|patch|purge)/i);
      }
    });

    it('AuditLogController.getCompanyActivity exige @Roles(admin)', () => {
      // L’activité de TOUTE l’entreprise ne doit pas fuiter à un simple membre.
      expect(methodGuardNames(AuditLogController.prototype, 'getCompanyActivity')).toContain(
        'RolesGuard',
      );
      expect(methodRoles(AuditLogController.prototype, 'getCompanyActivity')).toEqual(['admin']);
    });
  });

  describe('BillingController — gestion des forfaits réservée au platform-admin', () => {
    // BillingPlan est une table GLOBALE non tenant-scopée : un admin d’entreprise
    // qui pourrait la modifier relèverait/casserait les quotas de TOUS les tenants.
    it.each(['createPlan', 'updatePlan'])('%s exige SuperAdminGuard', (method) => {
      expect(methodGuardNames(BillingController.prototype, method)).toContain('SuperAdminGuard');
    });

    it.each(['getSubscription', 'createOrUpdateSubscription', 'cancelSubscription'])(
      '%s reste borné à @Roles(admin) de l’entreprise',
      (method) => {
        expect(methodRoles(BillingController.prototype, method)).toEqual(['admin']);
        expect(methodGuardNames(BillingController.prototype, method)).not.toContain(
          'SuperAdminGuard',
        );
      },
    );
  });

  describe('PlatformAdminController — SuperAdminGuard sur toutes les routes non publiques', () => {
    const proto = PlatformAdminController.prototype;
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');

    it('a au moins une route protégée', () => {
      expect(methods.length).toBeGreaterThan(0);
    });

    it.each(methods)(
      '%s : soit @Public, soit SuperAdminGuard (jamais ni l’un ni l’autre)',
      (method) => {
        const guards = methodGuardNames(proto, method);
        expect(methodIsPublic(proto, method) || guards.includes('SuperAdminGuard')).toBe(true);
      },
    );
  });
});
