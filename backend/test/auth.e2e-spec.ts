import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'Auth Test Company' } });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'StrongPass123',
    firstName: 'John',
    lastName: 'Doe',
  };

  let accessToken: string;

  describe('POST /auth/register', () => {
    it('should register a new user with company creation', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: 'New Test Company',
          email: 'new@example.com',
          password: 'StrongPass123!',
          firstName: 'Jane',
          lastName: 'Smith',
        })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe('new@example.com');
      expect(res.body.user.role).toBe('admin');
      accessToken = res.body.accessToken;

      // Cleanup
      await prisma.user.delete({ where: { email: 'new@example.com' } });
      // The company was created — find it by name
      const createdCompany = await prisma.company.findFirst({
        where: { name: 'New Test Company' },
      });
      if (createdCompany) {
        await prisma.company.delete({ where: { id: createdCompany.id } });
      }
    });

    it('should reject duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: 'Dup Company',
          email: 'new@example.com',
          password: 'StrongPass123!',
          firstName: 'A',
          lastName: 'B',
        })
        .expect(409);
    });

    it('should reject weak password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          companyName: 'Weak Co',
          email: 'weak@example.com',
          password: 'short',
          firstName: 'A',
          lastName: 'B',
        })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeAll(async () => {
      const hash = await bcrypt.hash('StrongPass123', 12);
      await prisma.user.create({
        data: {
          email: testUser.email,
          passwordHash: hash,
          firstName: testUser.firstName,
          lastName: testUser.lastName,
          role: 'dispatcher',
          companyId,
        },
      });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { companyId } });
    });

    it('should login and return tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'StrongPass123' })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe(testUser.email);
      accessToken = res.body.accessToken;
    });

    it('should reject wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'wrong' })
        .expect(401);
    });

    it('should set refresh token as httpOnly cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'StrongPass123' });

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.startsWith('refreshToken='))
        : cookies;
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/');
    });

    it('should record a login_success audit entry for successful logins', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'StrongPass123' })
        .expect(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: testUser.email } });
      const entry = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'login_success',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).toBeDefined();
      expect(entry!.companyId).toBe(companyId);
      expect(entry!.userAgent).toBeDefined();
    });

    it('should record a login_failed audit entry for wrong passwords', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'wrong-password' })
        .expect(401);

      const user = await prisma.user.findUniqueOrThrow({ where: { email: testUser.email } });
      const entry = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          action: 'login_failed',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).toBeDefined();
      expect(entry!.companyId).toBe(companyId);
    });

    it('should record a login_failed audit entry without companyId for unknown users', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'unknown@example.com', password: 'whatever123' })
        .expect(401);

      const entry = await prisma.auditLog.findFirst({
        where: {
          userId: null,
          companyId: null,
          action: 'login_failed',
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(entry).toBeDefined();
    });
  });

  describe('GET /sessions/history', () => {
    beforeAll(async () => {
      const existing = await prisma.user.findUnique({ where: { email: testUser.email } });
      if (!existing) {
        const hash = await bcrypt.hash('StrongPass123', 12);
        await prisma.user.create({
          data: {
            email: testUser.email,
            passwordHash: hash,
            firstName: testUser.firstName,
            lastName: testUser.lastName,
            role: 'dispatcher',
            companyId,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { companyId } });
    });

    it('returns login history containing login_success entries', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'StrongPass123' })
        .expect(200);

      const accessToken = loginRes.body.accessToken as string;
      expect(accessToken).toBeDefined();

      const res = await request(app.getHttpServer())
        .get('/sessions/history')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const successEntries = res.body.filter(
        (e: { action: string }) => e.action === 'login_success',
      );
      expect(successEntries.length).toBeGreaterThan(0);
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should always return the same generic message', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);

      expect(res.body.message).toContain('Si un compte existe');
    });

    it('should return success even for existing user (no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testUser.email })
        .expect(200);

      expect(res.body.message).toContain('Si un compte existe');
    });

    it('should create a reset token in database', async () => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testUser.email });

      const user = await prisma.user.findUnique({ where: { email: testUser.email } });
      expect(user?.resetTokenHash).not.toBeNull();
      expect(user?.resetTokenExpiry).not.toBeNull();
    });
  });

  describe('POST /auth/reset-password', () => {
    let resetToken: string;

    beforeAll(async () => {
      // Create a reset token for the test user
      resetToken = 'valid-reset-token-' + Date.now();
      const hashedToken = await bcrypt.hash(resetToken, 10);
      const expiry = new Date(Date.now() + 30 * 60 * 1000);
      await prisma.user.update({
        where: { email: testUser.email },
        data: { resetTokenHash: hashedToken, resetTokenExpiry: expiry },
      });
    });

    afterAll(async () => {
      await prisma.user.update({
        where: { email: testUser.email },
        data: { resetTokenHash: null, resetTokenExpiry: null },
      });
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewStrongPass123!';
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: resetToken, password: newPassword })
        .expect(200);

      // Verify new password works
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: newPassword })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('should reject expired token', async () => {
      const expiredToken = 'expired-token';
      const hashedToken = await bcrypt.hash(expiredToken, 10);
      const expiry = new Date(Date.now() - 60 * 1000); // 1 minute ago
      await prisma.user.update({
        where: { email: testUser.email },
        data: { resetTokenHash: hashedToken, resetTokenExpiry: expiry },
      });

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: expiredToken, password: 'NewStrongPass456!' })
        .expect(400);
    });

    it('should reject invalid token', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'completely-fake-token', password: 'NewStrongPass456!' })
        .expect(400);
    });

    it('should invalidate refresh tokens after reset', async () => {
      // Login first to get a refresh token
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'NewStrongPass123!' });

      const refreshCookie = loginRes.headers['set-cookie'];

      // Reset password
      const newToken = 'another-valid-token-' + Date.now();
      const hashedToken = await bcrypt.hash(newToken, 10);
      await prisma.user.update({
        where: { email: testUser.email },
        data: {
          resetTokenHash: hashedToken,
          resetTokenExpiry: new Date(Date.now() + 30 * 60 * 1000),
        },
      });

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: newToken, password: 'FinalPass123!' });

      // Old refresh token should no longer work
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        // The refresh endpoint reads from cookie, not body
        .set(
          'Cookie',
          Array.isArray(refreshCookie) ? refreshCookie.join('; ') : refreshCookie || '',
        )
        .expect(401);
    });
  });

  describe('POST /auth/reset-password validation', () => {
    it('should reject password shorter than 12 chars', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'some-token', password: 'Short1!' })
        .expect(400);
    });

    it('should reject password without uppercase', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'some-token', password: 'lowercaseonly1!' })
        .expect(400);
    });

    it('should reject password without special character', async () => {
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'some-token', password: 'NoSpecialChar1' })
        .expect(400);
    });
  });
});
