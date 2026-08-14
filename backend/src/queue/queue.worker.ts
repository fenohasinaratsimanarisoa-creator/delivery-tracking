import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { QueueWorkerModule } from './queue.worker.module';

const logger = new Logger('QueueWorker');

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(QueueWorkerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  logger.log(
    'Queue worker started — fuel-analysis, company-purge, webhook-retry processors active',
  );
}

bootstrapWorker().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Queue worker failed to start', err);
  process.exit(1);
});
