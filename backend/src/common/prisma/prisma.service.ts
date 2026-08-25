import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { uuidSafetyMiddleware } from './uuid-safety.middleware';
import { tenantScopeMiddleware } from './tenant-scope.middleware';

/**
 * Résilience au démarrage (incident du 25/08 : DB Render suspendue → crash-loop
 * "Port scan timeout" à chaque deploy). Un $connect qui échoue une fois ne doit
 * PAS tuer le process immédiatement : les cold starts Postgres (Render/Neon) et
 * les bascules réseau durent quelques secondes. On retente avec backoff borné —
 * au total ~2 min max — avant d'abandonner (échec franc, pas de demi-mort).
 */
const CONNECT_MAX_ATTEMPTS = 12;
const CONNECT_BASE_DELAY_MS = 3_000; // 3s, 6s, 9s… plafonné à 15s → total ≈ 105 s
const CONNECT_MAX_DELAY_MS = 15_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'query'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });
  }

  async onModuleInit() {
    this.$use(uuidSafetyMiddleware);
    this.$use(tenantScopeMiddleware);
    await this.connectWithRetry();
  }

  private async connectWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= CONNECT_MAX_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        if (attempt > 1) {
          this.logger.log(`Database connected after ${attempt} attempts`);
        }
        return;
      } catch (err) {
        lastError = err;
        const code = (err as { errorCode?: string })?.errorCode ?? '';
        const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
        // P1001 = serveur injoignable : seul cas où le retry a un sens. Une
        // mauvaise authentification (P1000) ou une URL invalide échouerait de
        // toute façon à chaque tentative — on abandonne plus vite en la
        // relançant quand même (le coût est borné par CONNECT_MAX_ATTEMPTS).
        this.logger.error(
          `Database connection failed (attempt ${attempt}/${CONNECT_MAX_ATTEMPTS})${code ? ` [${code}]` : ''}: ${message}`,
        );
        if (attempt < CONNECT_MAX_ATTEMPTS) {
          const delay = Math.min(CONNECT_BASE_DELAY_MS * attempt, CONNECT_MAX_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
