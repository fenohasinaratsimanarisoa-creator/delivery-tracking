import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CsrfGuard } from './common/guards/csrf.guard';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module';
import { MonitoringModule } from './common/monitoring/monitoring.module';
import { AlertModule } from './common/alerting/alert.module';
import { EncryptionModule } from './common/encryption/encryption.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FuelConsumptionModule } from './modules/fuel-consumption/fuel-consumption.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { DigestModule } from './modules/digest/digest.module';
import { BillingModule } from './modules/billing/billing.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RoutingModule } from './modules/routing/routing.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { RedisModule } from './common/redis/redis.module';
import { CacheModule } from './common/cache/cache.module';
import { DataUpdateModule } from './common/events/data-update.module';
import { TenantModule } from './common/tenant/tenant.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule,
    CacheModule,
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: {
          ignore: (req) => ['/health', '/metrics'].includes((req as any).url || ''),
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
            : undefined,
        customProps: (req) => ({
          requestId: (req as any).requestId,
          userId: (req as any).user?.id,
          companyId: (req as any).user?.companyId,
        }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'body.password',
            'body.token',
            'body.accessToken',
            'body.refreshToken',
            'body.secret',
          ],
          censor: '[REDACTED]',
        },
        level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
      },
    }),
    ...(process.env.REDIS_URL
      ? [
          ThrottlerModule.forRootAsync({
            useFactory: () => {
              const redisUrl = process.env.REDIS_URL!;
              const redis = new Redis(redisUrl, {
                maxRetriesPerRequest: null,
                enableOfflineQueue: true,
                retryStrategy: () => 5000,
                lazyConnect: false,
              });
              return {
                throttlers: [
                  { name: 'short', ttl: 1000, limit: 3 },
                  { name: 'medium', ttl: 10000, limit: 20 },
                  { name: 'long', ttl: 60000, limit: 100 },
                ],
                storage: new ThrottlerStorageRedisService(redis),
              };
            },
          }),
        ]
      : [
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 1000, limit: 3 },
            { name: 'medium', ttl: 10000, limit: 20 },
            { name: 'long', ttl: 60000, limit: 100 },
          ]),
        ]),
    PrismaModule,
    MonitoringModule,
    AlertModule,
    EncryptionModule,
    DataUpdateModule,
    TenantModule,
    HealthModule,
    MetricsModule,
    QueueModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    VehiclesModule,
    DriversModule,
    DeliveriesModule,
    TrackingModule,
    FuelConsumptionModule,
    NotificationsModule,
    DashboardModule,
    InvitationsModule,
    SessionsModule,
    AuditLogModule,
    DigestModule,
    BillingModule,
    PlatformAdminModule,
    ApiKeysModule,
    WebhooksModule,
    ReportsModule,
    RoutingModule,
    AlertsModule,
    GeocodingModule,
  ],
  providers: [
    // Rate limiting is disabled in tests: e2e suites burst past the per-route
    // limits (e.g. reset-password allows 5 req/min).
    ...(process.env.NODE_ENV === 'test'
      ? [{ provide: APP_GUARD, useValue: { canActivate: () => true } }]
      : [{ provide: APP_GUARD, useClass: ThrottlerGuard }]),
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
