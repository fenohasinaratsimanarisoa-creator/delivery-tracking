import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { QueueWorkerModule } from './queue.worker.module';

const logger = new Logger('QueueWorker');

// AVANT createApplicationContext (qui instancie tous les providers, TraccarBridgeService
// inclus) : FuelConsumptionModule importe TrackingModule (pour TrackingGateway), qui
// fournit AUSSI TraccarBridgeService — son onModuleInit tournerait donc ICI, dans le
// worker, EN PLUS de celle du process "backend". Or createApplicationContext ne démarre
// AUCUN adaptateur WebSocket : TrackingGateway.server reste undefined dans ce process,
// donc toute diffusion temps réel (broadcastToCompany/broadcastDataUpdate) faite depuis
// une instance de pont tournant ICI est silencieusement perdue (no-op sur `this.server?.`)
// — vécu en prod : le worker gagnait parfois l'élection de leader Redis du pont Traccar,
// et les positions GPS temps réel n'atteignaient alors JAMAIS le navigateur par WebSocket
// (retour à un rafraîchissement différé, perçu comme de la latence). Ce flag fait sortir
// TraccarBridgeService.onModuleInit en no-op immédiat dans CE process, pour que seul le
// process "backend" (qui a un vrai serveur WS) puisse jamais devenir leader du pont.
process.env.IS_QUEUE_WORKER = '1';

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
