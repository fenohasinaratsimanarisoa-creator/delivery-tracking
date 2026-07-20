import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'Auth Test Company' } });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'StrongPass123',
    firstName: 'John',
    lastName: 'Doe',
    role: 'dispatcher' as const,
  };

  let accessToken: string;
  let refreshToken: string;

  it('POST /auth/register - should register a new user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...testUser, companyId })
      .expect(201);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.user.email).toBe(testUser.email);
    expect(res.body.user.role).toBe(testUser.role);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/register - should reject duplicate email', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ ...testUser, companyId })
      .expect(409);
  });

  it('POST /auth/login - should login and return tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/login - should reject wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'wrong' })
      .expect(401);
  });

  it('GET /users/me - should access protected route with valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.email).toBe(testUser.email);
  });

  it('GET /users/me - should reject request without token', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .expect(401);
  });

  it('GET /users/me - should reject request with invalid token', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('POST /auth/refresh - should return new tokens', async () => {
    const oldAccessToken = accessToken;
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('refreshToken');
    expect(res.body.refreshToken).not.toBe(refreshToken);
    // Update tokens
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('POST /auth/refresh - should reject invalid refresh token', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: 'invalid-refresh-token' })
      .expect(401);
  });

  it('POST /auth/logout - should invalidate refresh token', async () => {
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    // Refresh should now fail
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('POST /auth/login - should still work after logout', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200);

    expect(res.body).toHaveProperty('accessToken');
    accessToken = res.body.accessToken;
  });
});
