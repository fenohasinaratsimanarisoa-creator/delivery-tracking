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

  if (process.env.NODE_ENV === 'production' || process.env.ENFORCE_HTTPS === 'true') {
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
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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
    app.get(Logger).warn('[STARTUP] No alert webhook configured — critical alerts will not be sent');
  }
}
bootstrap();
