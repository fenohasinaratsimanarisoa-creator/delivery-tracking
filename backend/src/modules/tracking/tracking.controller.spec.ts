import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnauthorizedException,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TrackingController } from './tracking.controller';
import { SKIP_CSRF_KEY } from '../../common/decorators/skip-csrf.decorator';
import { TrackingService } from './tracking.service';
import { TraccarBridgeService } from './traccar-bridge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { DeviceTrackingAuthGuard } from '../../common/guards/device-tracking-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { ApiKeyOrJwtGuard } from '../api-keys/guards/api-key-or-jwt.guard';
import { PrismaService } from '../../common/prisma/prisma.service';

// =============================================================================
// PATCH /tracking/reliability-status — verrou d'autorisation.
//
// Contrat vérifié :
//  1. Seul le rôle 'driver' peut appeler cet endpoint (RolesGuard RÉEL, non
//     mocké — les autres guards sont neutralisés car hors périmètre ici).
//  2. Le statut mis à jour est TOUJOURS celui du chauffeur authentifié
//     (@CurrentUser('id') → userId du token) : le DTO n'expose aucun champ
//     driverId, et forbidNonWhitelisted rejette explicitement toute tentative
//     d'en glisser un — un chauffeur ne peut structurellement pas viser le
//     statut d'un autre.
// =============================================================================

const mockTrackingService = {
  updateTrackingReliability: jest.fn(),
  validateAndSaveBatch: jest.fn(),
  ingestSmsRelayPosition: jest.fn(),
};

describe('TrackingController — PATCH /tracking/reliability-status (autorisation)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TraccarBridgeService, useValue: {} },
        // Non utilisé par les routes testées ici, mais requis pour résoudre
        // ApiKeyOrJwtGuard (@UseGuards sur d'autres routes du même controller).
        { provide: PrismaService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(DeviceTrackingAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CompanyScopeGuard)
      .useValue({ canActivate: () => true })
      // RolesGuard NON mocké : c'est précisément ce qu'on veut vérifier.
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // Simule le middleware d'auth : role/userId pilotés par des en-têtes de
    // test pour varier le rôle authentifié sans recréer l'app à chaque test.
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        id: req.headers['x-test-user-id'] || 'user-driver-1',
        companyId: 'company-1',
        role: req.headers['x-test-role'] || 'driver',
      };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("un rôle dispatcher est rejeté (403) — ne peut pas modifier le statut d'un chauffeur", async () => {
    const res = await request(app.getHttpServer())
      .patch('/tracking/reliability-status')
      .set('x-test-role', 'dispatcher')
      .send({ status: 'battery_opt_not_ignored' });

    expect(res.status).toBe(403);
    expect(mockTrackingService.updateTrackingReliability).not.toHaveBeenCalled();
  });

  it("un rôle admin est rejeté (403) — ne peut pas modifier le statut d'un chauffeur", async () => {
    const res = await request(app.getHttpServer())
      .patch('/tracking/reliability-status')
      .set('x-test-role', 'admin')
      .send({ status: 'battery_opt_not_ignored' });

    expect(res.status).toBe(403);
    expect(mockTrackingService.updateTrackingReliability).not.toHaveBeenCalled();
  });

  it('un rôle driver met à jour SON PROPRE statut (userId résolu depuis le token, jamais du body)', async () => {
    mockTrackingService.updateTrackingReliability.mockResolvedValue({
      updated: true,
      trackingReliability: 'battery_opt_not_ignored',
    });

    const res = await request(app.getHttpServer())
      .patch('/tracking/reliability-status')
      .set('x-test-role', 'driver')
      .set('x-test-user-id', 'user-driver-1')
      .send({ status: 'battery_opt_not_ignored' });

    expect(res.status).toBe(200);
    expect(mockTrackingService.updateTrackingReliability).toHaveBeenCalledWith(
      'user-driver-1',
      'battery_opt_not_ignored',
    );
  });

  it('un driverId injecté dans le body est rejeté (400, forbidNonWhitelisted) — impossible de viser un autre chauffeur', async () => {
    const res = await request(app.getHttpServer())
      .patch('/tracking/reliability-status')
      .set('x-test-role', 'driver')
      .set('x-test-user-id', 'user-driver-1')
      .send({ status: 'reliable', driverId: 'un-autre-chauffeur' });

    expect(res.status).toBe(400);
    expect(mockTrackingService.updateTrackingReliability).not.toHaveBeenCalled();
  });
});

// =============================================================================
// POST /tracking/positions/native-batch — endpoint REST natif (Phase 2),
// indépendant du WebSocket. Applique EXACTEMENT le même garde-fou anti-flood
// et la même logique de sauvegarde que 'batchPosition' (gateway), via la
// méthode partagée TrackingService.validateAndSaveBatch (voir aussi
// tracking.gateway.spec.ts / tracking.gateway.integration.spec.ts, adaptés au
// même refactor).
// =============================================================================

const UUID_A = '11111111-1111-4111-8111-111111111111';

function makeValidPosition(index: number) {
  return {
    latitude: -18.8792 + index * 0.0001,
    longitude: 47.5079,
    accuracy: 12,
    speed: 5,
    heading: 90,
    timestamp: new Date(2026, 7, 20, 10, 0, index).toISOString(),
    vehicleId: UUID_A,
  };
}

describe('TrackingController — POST /tracking/positions/native-batch', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TraccarBridgeService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      // JwtAuthGuard mocké pour REPRODUIRE fidèlement son comportement observable
      // (rejette sans Authorization, peuple req.user sinon) sans dépendre de la
      // stratégie Passport réelle (hors périmètre ici — testée ailleurs) : c'est
      // précisément le comportement "sans JWT valide → 401" qu'on veut vérifier.
      .overrideGuard(DeviceTrackingAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['authorization']) {
            throw new UnauthorizedException('Invalid or expired token');
          }
          req.user = {
            id: req.headers['x-test-user-id'] || 'user-driver-1',
            companyId: 'company-1',
            role: req.headers['x-test-role'] || 'driver',
          };
          return true;
        },
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CompanyScopeGuard)
      .useValue({ canActivate: () => true })
      // RolesGuard NON mocké : @Roles('driver') doit rester appliqué.
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('50 positions valides → { saved: 50, duplicates: 0 }', async () => {
    const positions = Array.from({ length: 50 }, (_, i) => makeValidPosition(i));
    mockTrackingService.validateAndSaveBatch.mockResolvedValueOnce({
      status: 'ok',
      saved: positions.map((p, i) => ({ id: `saved-${i}`, ...p })),
      validatedCount: 50,
      driverId: 'driver-1',
    });

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .set('authorization', 'Bearer fake-token')
      .send({ positions });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: 50, duplicates: 0 });
    expect(mockTrackingService.validateAndSaveBatch).toHaveBeenCalledWith(
      'user-driver-1',
      'company-1',
      expect.any(Array),
    );
    expect(mockTrackingService.validateAndSaveBatch.mock.calls[0][2]).toHaveLength(50);
  });

  it('positions en doublon exact (vehicleId+timestamp déjà en base) → duplicates > 0, saved reflète le vrai compte, pas de crash', async () => {
    // 5 positions envoyées, seules 3 réellement insérées par saveBatch
    // (skipDuplicates a silencieusement ignoré les 2 doublons — logique
    // INCHANGÉE, cf. tracking.service.ts) : validateAndSaveBatch le reflète
    // déjà dans son `saved` (issu tel quel de saveBatch).
    const positions = Array.from({ length: 5 }, (_, i) => makeValidPosition(i));
    mockTrackingService.validateAndSaveBatch.mockResolvedValueOnce({
      status: 'ok',
      saved: [
        { id: 'saved-0', ...positions[0] },
        { id: 'saved-1', ...positions[1] },
        { id: 'saved-2', ...positions[2] },
      ],
      validatedCount: 5,
      driverId: 'driver-1',
    });

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .set('authorization', 'Bearer fake-token')
      .send({ positions });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ saved: 3, duplicates: 2 });
  });

  it("sans JWT valide (pas d'en-tête Authorization) → 401", async () => {
    const positions = [makeValidPosition(0)];

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .send({ positions });

    expect(res.status).toBe(401);
    expect(mockTrackingService.validateAndSaveBatch).not.toHaveBeenCalled();
  });

  it('au-delà du rate limit (driver déjà au plafond) → 429, rejet propre, aucune perte silencieuse côté serveur', async () => {
    mockTrackingService.validateAndSaveBatch.mockResolvedValueOnce({ status: 'rate_limited' });

    const positions = Array.from({ length: 10 }, (_, i) => makeValidPosition(i));
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .set('authorization', 'Bearer fake-token')
      .send({ positions });

    // 429, pas 200 avec un faux "saved" : le client (PositionUploadWorker) ne
    // doit JAMAIS interpréter cette réponse comme un succès qui justifierait un
    // markSynced() — les positions restent en file SQLite locale pour retry
    // (backoff exponentiel WorkManager natif), même comportement que le rejet
    // 'positionsRejected' du chemin WebSocket (handleBatchPosition).
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ saved: 0, duplicates: 0 });
    // Le rate limit a bien été évalué EN AMONT de toute tentative de sauvegarde
    // (validateAndSaveBatch encapsule ce garde-fou — jamais contourné par ce
    // chemin REST natif).
    expect(mockTrackingService.validateAndSaveBatch).toHaveBeenCalledTimes(1);
  });

  it('aucun profil Driver résolvable (no_driver) → 422, PAS 200 — sinon PositionUploadWorker marquerait synced un lot jamais persisté (perte silencieuse, audit 2026-08-27)', async () => {
    mockTrackingService.validateAndSaveBatch.mockResolvedValueOnce({ status: 'no_driver' });

    const positions = Array.from({ length: 5 }, (_, i) => makeValidPosition(i));
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .set('authorization', 'Bearer fake-token')
      .send({ positions });

    // PositionUploadWorker.java ne lit JAMAIS le corps de la réponse : il
    // appelle markSynced() dès qu'il voit un statut 2xx, quel qu'il soit. Un
    // 200/{saved:0} ici ferait supprimer ces positions de la file SQLite
    // native alors qu'AUCUNE n'a été persistée côté serveur — perte
    // définitive. Un statut non-2xx est la SEULE façon de garantir qu'elles
    // restent en file pour retry.
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ saved: 0, duplicates: 0 });
  });

  it("rôle non-driver (dispatcher) rejeté (403) — même garde @Roles('driver') que les autres routes chauffeur", async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/native-batch')
      .set('authorization', 'Bearer fake-token')
      .set('x-test-role', 'dispatcher')
      .send({ positions: [makeValidPosition(0)] });

    expect(res.status).toBe(403);
    expect(mockTrackingService.validateAndSaveBatch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// POST /tracking/positions/sms-relay — canal de secours zéro-connectivité
// (audit terrain 2026-08-27). Authentifié par clé API (ApiKeyOrJwtGuard),
// PAS par JWT de session chauffeur : le téléphone-passerelle relaie pour
// toute la flotte, sans lien avec un chauffeur en particulier.
// =============================================================================

function makeValidSmsRelayBody() {
  return {
    senderPhone: '+261341234567',
    latitude: -18.8792,
    longitude: 47.5079,
    accuracy: 15,
    timestamp: new Date().toISOString(),
  };
}

describe('TrackingController — POST /tracking/positions/sms-relay', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TrackingController],
      providers: [
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: JwtService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: TraccarBridgeService, useValue: {} },
        { provide: PrismaService, useValue: {} },
      ],
    })
      // Simule le comportement observable d'ApiKeyOrJwtGuard authentifié par
      // clé API : req.user.companyId peuplé, aucun lien chauffeur (contrairement
      // aux autres routes de ce fichier, authentifiées par session driver).
      .overrideGuard(ApiKeyOrJwtGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers['x-api-key']) {
            throw new UnauthorizedException('Missing X-API-Key header');
          }
          req.user = { companyId: 'company-1', type: 'api_key' };
          return true;
        },
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(DeviceTrackingAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CompanyScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('position valide → 200, service appelé avec companyId + dto normalisé', async () => {
    mockTrackingService.ingestSmsRelayPosition.mockResolvedValueOnce({ status: 'ok' });
    const body = makeValidSmsRelayBody();

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .set('x-api-key', 'test-key')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(mockTrackingService.ingestSmsRelayPosition).toHaveBeenCalledWith(
      'company-1',
      expect.objectContaining({ senderPhone: body.senderPhone, latitude: body.latitude }),
    );
  });

  it('sans clé API → 401, service jamais appelé', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .send(makeValidSmsRelayBody());

    expect(res.status).toBe(401);
    expect(mockTrackingService.ingestSmsRelayPosition).not.toHaveBeenCalled();
  });

  it('aucun chauffeur ne correspond au numéro émetteur (no_driver_match) → 422, jamais 200', async () => {
    mockTrackingService.ingestSmsRelayPosition.mockResolvedValueOnce({ status: 'no_driver_match' });

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .set('x-api-key', 'test-key')
      .send(makeValidSmsRelayBody());

    // Même politique que 'no_driver' sur native-batch : jamais un 200 trompeur
    // qui ferait croire à la passerelle que la position a été attribuée.
    expect(res.status).toBe(422);
  });

  it('position rejetée par savePosition (dédoublonnée/téléportation/véhicule invalide) → 422', async () => {
    mockTrackingService.ingestSmsRelayPosition.mockResolvedValueOnce({ status: 'rejected' });

    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .set('x-api-key', 'test-key')
      .send(makeValidSmsRelayBody());

    expect(res.status).toBe(422);
  });

  it('latitude hors bornes (400, ValidationPipe) — jamais transmis au service', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .set('x-api-key', 'test-key')
      .send({ ...makeValidSmsRelayBody(), latitude: 999 });

    expect(res.status).toBe(400);
    expect(mockTrackingService.ingestSmsRelayPosition).not.toHaveBeenCalled();
  });

  it('champ vehicleId injecté dans le body est rejeté (400, forbidNonWhitelisted) — le véhicule ne peut être choisi que par le serveur', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/positions/sms-relay')
      .set('x-api-key', 'test-key')
      .send({ ...makeValidSmsRelayBody(), vehicleId: '11111111-1111-4111-8111-111111111111' });

    expect(res.status).toBe(400);
    expect(mockTrackingService.ingestSmsRelayPosition).not.toHaveBeenCalled();
  });

  it("porte @SkipCsrf() (audit terrain 2026-08-27, régression réelle : 403 \"Missing CSRF token\" sur TOUT appel jusqu'à ce que la clé API vienne d'être testée en conditions réelles — l'appelant natif ne peut structurellement jamais fournir de jeton CSRF, comme native-batch)", () => {
    const reflector = new Reflector();
    const skipCsrf = reflector.get(SKIP_CSRF_KEY, TrackingController.prototype.ingestSmsRelay);
    expect(skipCsrf).toBe(true);
  });
});
