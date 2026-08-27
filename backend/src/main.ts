import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as bodyParser from 'body-parser';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { AppModule } from './app.module';
import { getCorsOrigins } from './config/cors';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AlertService } from './common/alerting/alert.service';
import { validateCsrfSecret } from './common/guards/csrf.guard';
import { MobileMoneyService } from './modules/billing/mobile-money.service';
import { StripeService } from './modules/billing/stripe.service';

class RedisIoAdapter extends IoAdapter {
  createIOServer(port: number, options?: any) {
    const server = super.createIOServer(port, options);
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.log('REDIS_URL not set — using in-memory Socket.IO adapter');
      return server;
    }
    const pubClient = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: true,
      retryStrategy: () => 5000,
      lazyConnect: false,
    });
    pubClient.on('error', () => {});
    const subClient = pubClient.duplicate();
    server.adapter(createAdapter(pubClient, subClient));
    return server;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // Derrière les proxies (Render) : req.ip et req.secure doivent refléter le
  // client réel via X-Forwarded-For / X-Forwarded-Proto, pas l'adresse du proxy.
  (app.getHttpAdapter().getInstance() as any).set('trust proxy', 1);

  const configService = app.get(ConfigService);
  validateCsrfSecret(configService);
  MobileMoneyService.validateSandbox(configService);
  StripeService.validateConfig(configService);

  const encryptionKey = configService.get<string>('ENCRYPTION_KEY');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  if (!encryptionKey && nodeEnv === 'production') {
    throw new Error(
      'ENCRYPTION_KEY is required in production for PII at-rest encryption. ' +
        'Generate one with: openssl rand -hex 32',
    );
  }

  // REDIS_URL obligatoire en production : sans Redis, plusieurs contrôles de
  // sécurité se désactivent SILENCIEUSEMENT — verrou anti-brute-force du login,
  // révocation d'access token au logout, rate-limiting partagé entre instances,
  // idempotence des webhooks Stripe, verrou distribué des crons. Même garde-fou
  // que JWT/CSRF/ENCRYPTION : échec au boot en prod, simple avertissement en dev.
  if (!configService.get<string>('REDIS_URL')) {
    if (nodeEnv === 'production') {
      throw new Error(
        'REDIS_URL is required in production (login lockout, token revocation, ' +
          'shared rate-limiting, cron locking all silently disable without it).',
      );
    }
    app.get(Logger).warn('[STARTUP] REDIS_URL not set — security controls degraded (dev only)');
  }

  // Secrets JWT : même garde-fou que CSRF_SECRET / ENCRYPTION_KEY. Sans eux, le
  // JwtModule s'enregistre avec un secret undefined et les premiers sign()
  // échouent au runtime avec des erreurs cryptiques. En prod, échec au boot ;
  // en dev, simple avertissement (valeurs par défaut tolérées).
  const jwtAccessSecret = configService.get<string>('JWT_ACCESS_SECRET');
  const jwtRefreshSecret = configService.get<string>('JWT_REFRESH_SECRET');
  if (nodeEnv === 'production') {
    if (!jwtAccessSecret || !jwtRefreshSecret) {
      throw new Error(
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required in production. ' +
          'Generate them with: openssl rand -hex 64',
      );
    }
    if (jwtAccessSecret === jwtRefreshSecret) {
      app
        .get(Logger)
        .warn(
          '[STARTUP] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are IDENTICAL — use distinct secrets',
        );
    }
  } else if (!jwtAccessSecret || !jwtRefreshSecret) {
    app
      .get(Logger)
      .warn(
        '[STARTUP] JWT_ACCESS_SECRET / JWT_REFRESH_SECRET not set — JWT signing will fail. Set them in .env.',
      );
  }

  app.use(
    helmet({
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
    }),
  );

  // ENFORCE_HTTPS est censé être le SEUL interrupteur (voir .env.production.example :
  // "should be 'true' in production", donc togglable). Avant : le OR avec
  // NODE_ENV==='production' rendait la redirection inconditionnelle dès que
  // NODE_ENV=production, quelle que soit la valeur d'ENFORCE_HTTPS — impossible
  // de désactiver la redirection HTTPS en prod, ce qui cassait TOUT self-hosting
  // sans domaine/TLS devant l'API (boucle de redirection vers un port 443
  // inexistant). Constaté en déployant réellement sur un VPS sans HTTPS.
  if (process.env.ENFORCE_HTTPS === 'true') {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.headers['x-forwarded-proto'] === 'https' || req.secure) return next();
      if (req.headers.host) {
        res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      } else {
        next();
      }
    });
  }

  app.use(cookieParser());

  app.use('/billing/webhooks/stripe', bodyParser.raw({ type: 'application/json' }));
  app.use('/billing/webhooks/mobile-money', bodyParser.raw({ type: 'application/json' }));

  app.useWebSocketAdapter(new RedisIoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const alertService = app.get(AlertService);
  app.useGlobalFilters(new AllExceptionsFilter(alertService));

  app.enableCors({
    origin: getCorsOrigins(),
    credentials: true,
  });

  if (process.env.NODE_ENV === 'staging') {
    const config = new DocumentBuilder()
      .setTitle('DeliveryTrack API')
      .setDescription(
        'B2B integration API for DeliveryTrack — fleet & delivery management platform',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addApiKey(
        {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for read-only access (deliveries:read, tracking:read)',
        },
        'api-key',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    app.get(Logger).log('Swagger docs available at /api/docs');
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  app.get(Logger).log(`Application running on http://localhost:${port}`);

  if (!process.env.SENTRY_DSN) {
    app.get(Logger).warn('[STARTUP] SENTRY_DSN not set — errors will NOT be reported to Sentry');
  }
  if (process.env.BILLING_ENABLED !== 'true') {
    app.get(Logger).log('[STARTUP] BILLING_ENABLED=false — pilot mode, quotas disabled');
  }
  if (!process.env.ALERT_SLACK_WEBHOOK && !process.env.ALERT_DISCORD_WEBHOOK) {
    app
      .get(Logger)
      .warn('[STARTUP] No alert webhook configured — critical alerts will not be sent');
  }
}
bootstrap();
