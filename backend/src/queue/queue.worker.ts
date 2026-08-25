import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { QueueWorkerModule } from './queue.worker.module';

const logger = new Logger('QueueWorker');

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(QueueWorkerModule, {
    bufferLogs: true,
  });
  // QueueWorkerModule enregistre son logger via LoggerModule.forRoot() (nestjs-pino),
  // qui expose le jeton Logger DE nestjs-pino — PAS celui de @nestjs/common (jamais
  // enregistré dans ce contexte). Avant : app.get(Logger) avec le mauvais import
  // levait UnknownElementException et faisait crash-looper le worker au démarrage
  // (jamais détecté : Render ne déploie aucun service "worker", voir render.yaml).
  app.useLogger(app.get(PinoLogger));
  logger.log(
    'Queue worker started — fuel-analysis, company-purge, webhook-retry processors active',
  );
}

bootstrapWorker().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Queue worker failed to start', err);
  process.exit(1);
});
