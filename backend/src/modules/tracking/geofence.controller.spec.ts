import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { GeofenceController } from './geofence.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const DELIVERY_ID = '123e4567-e89b-4d3a-8457-426614174000';

const mockPrisma = {
  delivery: { findUnique: jest.fn() },
  geofence: { create: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
};

describe('GeofenceController — CreateGeofenceDto (validation radiusMeters)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GeofenceController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CompanyScopeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Même pipeline que main.ts (whitelist + forbidNonWhitelisted + transform).
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // Fournit le companyId attendu par @CurrentUser('companyId').
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { companyId: 'c1', role: 'admin' };
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

  it('rejette radiusMeters=0 avec 400 et un message clair (aucun insert)', async () => {
    const res = await request(app.getHttpServer()).post('/geofences').send({
      deliveryId: DELIVERY_ID,
      name: 'Zone A',
      lat: -18.87,
      lng: 47.52,
      radiusMeters: 0,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('radiusMeters')]),
    );
    expect(res.body.message.join(' ')).toContain('10 mètres');
    expect(mockPrisma.geofence.create).not.toHaveBeenCalled();
  });

  it('rejette radiusMeters=-5 avec 400 et un message clair (aucun insert)', async () => {
    const res = await request(app.getHttpServer()).post('/geofences').send({
      deliveryId: DELIVERY_ID,
      name: 'Zone A',
      lat: -18.87,
      lng: 47.52,
      radiusMeters: -5,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('radiusMeters')]),
    );
    expect(res.body.message.join(' ')).toContain('10 mètres');
    expect(mockPrisma.geofence.create).not.toHaveBeenCalled();
  });

  it('rejette radiusMeters absent avec 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/geofences')
      .send({ deliveryId: DELIVERY_ID, name: 'Zone A', lat: -18.87, lng: 47.52 });

    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('radiusMeters')]),
    );
    expect(mockPrisma.geofence.create).not.toHaveBeenCalled();
  });

  it('accepte un radius valide (>= 10m) — pas de régression sur le flux normal', async () => {
    mockPrisma.delivery.findUnique.mockResolvedValue({ companyId: 'c1' });
    mockPrisma.geofence.create.mockResolvedValue({ id: 'gf-1', companyId: 'c1' });

    const res = await request(app.getHttpServer()).post('/geofences').send({
      deliveryId: DELIVERY_ID,
      name: 'Zone A',
      lat: -18.87,
      lng: 47.52,
      radiusMeters: 200,
    });

    expect(res.status).toBe(201);
    expect(mockPrisma.geofence.create).toHaveBeenCalledTimes(1);
  });
});
