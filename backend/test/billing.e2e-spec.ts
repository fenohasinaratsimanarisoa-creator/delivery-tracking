import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('Billing Flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let accessToken: string;
  let planId: string;
  let subscriptionId: string;
  const testEmail = `billing-e2e-${Date.now()}@test.com`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const regRes = await request(app.getHttpServer()).post('/auth/register').send({
      email: testEmail,
      password: 'StrongPass123!',
      firstName: 'Billing',
      lastName: 'E2E',
      companyName: 'Billing E2E Co',
    });

    accessToken = regRes.body.accessToken;
  }, 30000);

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      const cid = user.companyId;
      await prisma.vehicle.deleteMany({ where: { companyId: cid } });
      await prisma.usageRecord.deleteMany({ where: { companyId: cid } });
      await prisma.invoice.deleteMany({ where: { companyId: cid } });
      await prisma.subscription.deleteMany({ where: { companyId: cid } });
      await prisma.user.deleteMany({ where: { companyId: cid } });
      await prisma.company.delete({ where: { id: cid } });
    }
    await app.close();
  });

  it('GET /billing/plans returns active plans sorted by price', async () => {
    const res = await request(app.getHttpServer())
      .get('/billing/plans')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
    expect(res.body[0].tier).toBe('free');
    expect(res.body[0].price).toBe(0);
    planId = res.body[1].id;
  });

  it('POST /billing/subscription creates checkout with sessionUrl', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/subscription')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ planId, provider: 'stripe' })
      .expect(201);

    expect(res.body.provider).toBe('stripe');
    expect(res.body.sessionUrl).toBeDefined();
    expect(res.body.subscriptionId).toBeDefined();
  });

  it('GET /billing/subscription returns company subscription', async () => {
    const res = await request(app.getHttpServer())
      .get('/billing/subscription')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.status).not.toBeNull();
    expect(res.body.planId).toBe(planId);
    subscriptionId = res.body.id;
  });

  it('POST /vehicles is blocked when subscription is canceled', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    await prisma.subscription.update({
      where: { companyId: user!.companyId },
      data: { status: 'canceled' },
    });

    const res = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        brand: 'Toyota',
        model: 'Hilux',
        licensePlate: `E2E-${Date.now()}`,
        fuelType: 'diesel',
        year: 2024,
      })
      .expect(403);

    expect(res.body.message).toContain('suspendu');
  });

  it('POST /vehicles passes when subscription is active', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    await prisma.subscription.update({
      where: { companyId: user!.companyId },
      data: { status: 'active', canceledAt: null },
    });

    const res = await request(app.getHttpServer())
      .post('/vehicles')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        brand: 'Toyota',
        model: 'Hilux',
        licensePlate: `E2E-${Date.now()}`,
        fuelType: 'diesel',
        year: 2024,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  it('GET /billing/usage returns current usage vs plan limits', async () => {
    const res = await request(app.getHttpServer())
      .get('/billing/usage')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('deliveriesUsed');
    expect(res.body).toHaveProperty('deliveriesLimit');
    expect(res.body).toHaveProperty('plan');
    expect(res.body.plan).toHaveProperty('name');
  });

  it('GET /billing/invoices returns paginated invoices', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    const sub = await prisma.subscription.findUnique({ where: { companyId: user!.companyId } });

    await prisma.invoice.create({
      data: {
        companyId: user!.companyId,
        subscriptionId: sub!.id,
        invoiceNumber: `INV-E2E-${Date.now()}`,
        amount: 2900,
        status: 'paid',
        provider: 'stripe',
        paidAt: new Date(),
      },
    });

    const res = await request(app.getHttpServer())
      .get('/billing/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.page).toBe(1);
  });

  it('GET /billing/invoices/:id/pdf returns a valid PDF', async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    const invoice = await prisma.invoice.findFirst({ where: { companyId: user!.companyId } });

    const res = await request(app.getHttpServer())
      .get(`/billing/invoices/${invoice!.id}/pdf`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.length).toBeGreaterThan(500);
  });
});
