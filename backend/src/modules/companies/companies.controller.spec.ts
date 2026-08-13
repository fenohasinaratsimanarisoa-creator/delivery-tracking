import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import * as request from 'supertest';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BlockImpersonationGuard } from '../../common/guards/block-impersonation.guard';
import { AllExceptionsFilter } from '../../common/filters/all-exceptions.filter';

const mockPrisma = {
  company: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { updateMany: jest.fn() },
  driver: { updateMany: jest.fn() },
  vehicle: { updateMany: jest.fn() },
};

describe('CompaniesController — DELETE :id confirmationName', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesController],
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('company-purge'), useValue: { add: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CompanyScopeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BlockImpersonationGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // Même filtre global que main.ts : c'est lui qui décide 400 vs 500.
    app.useGlobalFilters(new AllExceptionsFilter() as any);
    // Fournit le companyId attendu par @CurrentUser('companyId').
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { companyId: 'comp-1', role: 'admin' };
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

  it('renvoie 400 avec le message exact quand confirmationName ne correspond pas (PAS un 500)', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'comp-1', name: 'Acme Inc' });

    const res = await request(app.getHttpServer())
      .delete('/companies/comp-1')
      .send({ confirmationName: 'Wrong Name' });

    // 400, jamais 500 : une erreur client ne doit ni planter ni partir en Sentry.
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toBe('Company name confirmation does not match');
    // Aucun soft-delete n'a été exécuté.
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it('supprime la société (soft-delete) quand confirmationName correspond', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'comp-1', name: 'Acme Inc' });
    mockPrisma.company.update.mockResolvedValueOnce({ id: 'comp-1', deletedAt: new Date() });

    const res = await request(app.getHttpServer())
      .delete('/companies/comp-1')
      .send({ confirmationName: 'Acme Inc' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Company deleted successfully' });
    expect(mockPrisma.company.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { deletedAt: expect.any(Date) },
    });
  });
});
