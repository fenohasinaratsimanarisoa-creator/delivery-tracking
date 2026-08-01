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
    afterAll(async () => {
      await prisma.auditLog.deleteMany({
        where: { user: { email: 'new@example.com' } },
      });
      await prisma.userSession.deleteMany({
        where: { user: { email: 'new@example.com' } },
      });
      await prisma.user.deleteMany({ where: { email: 'new@example.com' } });
      const createdCompany = await prisma.company.findFirst({
        where: { name: 'New Test Company' },
      });
      if (createdCompany) {
        await prisma.company.delete({ where: { id: createdCompany.id } });
      }
    });

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
  });

  describe('POST /auth/forgot-password', () => {
    it('should always return the same generic message', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);

      expect(res.body.message).toContain('If an account exists');
    });

    it('should return success even for existing user (no enumeration)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: testUser.email })
        .expect(200);

      expect(res.body.message).toContain('If an account exists');
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
    let combinedToken: string;

    const seedResetToken = async (tokenId: string, secret: string, expiry: Date) => {
      const hashed = await bcrypt.hash(secret, 10);
      await prisma.user.update({
        where: { email: testUser.email },
        data: { resetTokenId: tokenId, resetTokenHash: hashed, resetTokenExpiry: expiry },
      });
    };

    beforeAll(async () => {
      // Current format is "resetTokenId:rawSecret" — the resetTokenId is
      // indexed on the user for O(1) lookup, rawSecret is bcrypt-hashed.
      const resetTokenId = `valid-reset-id-${Date.now()}`;
      const rawSecret = 'raw-secret-123';
      combinedToken = `${resetTokenId}:${rawSecret}`;
      await seedResetToken(resetTokenId, rawSecret, new Date(Date.now() + 30 * 60 * 1000));
    });

    afterAll(async () => {
      await prisma.user.update({
        where: { email: testUser.email },
        data: { resetTokenId: null, resetTokenHash: null, resetTokenExpiry: null },
      });
    });

    it('should reset password with valid token', async () => {
      const newPassword = 'NewStrongPass123!';
      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: combinedToken, password: newPassword })
        .expect(200);

      // Verify new password works
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: newPassword })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
    });

    it('should reject expired token', async () => {
      const tokenId = `expired-id-${Date.now()}`;
      const secret = 'expired-secret';
      await seedResetToken(tokenId, secret, new Date(Date.now() - 60 * 1000)); // 1 minute ago

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: `${tokenId}:${secret}`, password: 'NewStrongPass456!' })
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
      const tokenId = `invalidate-id-${Date.now()}`;
      const secret = 'invalidate-secret';
      await seedResetToken(tokenId, secret, new Date(Date.now() + 30 * 60 * 1000));

      await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: `${tokenId}:${secret}`, password: 'FinalPass123!' })
        .expect(200);

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
