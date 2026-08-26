import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { TraccarBridgeService } from './traccar-bridge.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
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

  it("un driverId injecté dans le body est rejeté (400, forbidNonWhitelisted) — impossible de viser un autre chauffeur", async () => {
    const res = await request(app.getHttpServer())
      .patch('/tracking/reliability-status')
      .set('x-test-role', 'driver')
      .set('x-test-user-id', 'user-driver-1')
      .send({ status: 'reliable', driverId: 'un-autre-chauffeur' });

    expect(res.status).toBe(400);
    expect(mockTrackingService.updateTrackingReliability).not.toHaveBeenCalled();
  });
});
