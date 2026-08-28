import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';
import * as cookieParser from 'cookie-parser';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

/**
 * Les handlers d'auth émettent délibérément DEUX Set-Cookie pour un même nom :
 * d'abord un `clearCookie` (valeur vide, `Expires=Thu, 01 Jan 1970`), puis le
 * cookie réel (garde-fou COOKIE_DOMAIN, cf. auth.controller.ts). Le navigateur
 * applique les en-têtes dans l'ordre → la valeur finale est la bonne, mais un
 * `.find(c => c.startsWith('refreshToken='))` naïf attrape le cookie VIDÉ.
 * Ce helper renvoie toujours l'entrée qui porte réellement une valeur.
 */
function pickSetCookie(setCookie: string | string[] | undefined, name: string): string | undefined {
  const arr = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const named = arr.filter((c) => c.startsWith(`${name}=`));
  const withValue = named.filter((c) => !c.startsWith(`${name}=;`));
  return (withValue.length ? withValue : named).pop();
}

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'Auth Test Company' } });
    companyId = company.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { companyId } });
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

  // POST /auth/refresh exige désormais la protection CSRF (cookie+headers) :
  // helper pour récupérer un couple csrf valide avant chaque refresh.
  async function fetchCsrf() {
    const res = await request(app.getHttpServer()).get('/auth/csrf-token').expect(200);
    const cookie = pickSetCookie(res.headers['set-cookie'], 'csrf-token');
    const cookieValue = (cookie || '').split(';')[0];
    return {
      cookie: cookieValue,
      token: res.body.csrfToken as string,
      hmac: res.body.csrfHmac as string,
    };
  }

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
      const refreshCookie = pickSetCookie(cookies, 'refreshToken');
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
      const csrf = await fetchCsrf();
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set(
          'Cookie',
          `${(pickSetCookie(refreshCookie, 'refreshToken') ?? '').split(';')[0]}; ${csrf.cookie}`,
        )
        .set('X-CSRF-Token', csrf.token)
        .set('X-CSRF-HMAC', csrf.hmac)
        // The refresh endpoint reads from cookie, not body
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

  describe('CSRF protection on refresh', () => {
    it('should reject POST /auth/refresh without CSRF headers', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'FinalPass123!' });
      const refreshCookie = loginRes.headers['set-cookie'];

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', (pickSetCookie(refreshCookie, 'refreshToken') ?? '').split(';')[0])
        .expect(403);
    });

    it('should accept POST /auth/refresh with CSRF headers', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: 'FinalPass123!' });
      const refreshCookie = loginRes.headers['set-cookie'];
      expect(refreshCookie).toBeDefined();

      const csrf = await fetchCsrf();
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set(
          'Cookie',
          `${(pickSetCookie(refreshCookie, 'refreshToken') ?? '').split(';')[0]}; ${csrf.cookie}`,
        )
        .set('X-CSRF-Token', csrf.token)
        .set('X-CSRF-HMAC', csrf.hmac)
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).not.toHaveProperty('refreshToken');
    });
  });

  describe('2FA login flow', () => {
    const twoFaUser = {
      email: 'twofa@example.com',
      password: 'StrongPass123',
      firstName: 'Totp',
      lastName: 'User',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    };

    beforeAll(async () => {
      const hash = await bcrypt.hash(twoFaUser.password, 12);
      await prisma.user.create({
        data: {
          email: twoFaUser.email,
          passwordHash: hash,
          firstName: twoFaUser.firstName,
          lastName: twoFaUser.lastName,
          role: 'dispatcher',
          companyId,
          totpSecret: twoFaUser.totpSecret,
          totpEnabled: true,
        },
      });
    });

    afterAll(async () => {
      await prisma.userSession.deleteMany({
        where: { user: { email: twoFaUser.email } },
      });
      await prisma.user.deleteMany({ where: { email: twoFaUser.email } });
    });

    it('step 1: returns tempToken and requiresTwoFactor, no refresh cookie', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: twoFaUser.email, password: twoFaUser.password })
        .expect(200);

      expect(res.body.requiresTwoFactor).toBe(true);
      expect(res.body.tempToken).toBeDefined();
      expect(res.body.tempToken.length).toBeGreaterThan(20);
      expect(res.body.accessToken).toBe('');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('step 2: verifies code and sets refresh + csrf cookies', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: twoFaUser.email, password: twoFaUser.password })
        .expect(200);
      const tempToken = loginRes.body.tempToken as string;
      expect(tempToken).toBeDefined();

      const code = speakeasy.totp({
        secret: twoFaUser.totpSecret,
        encoding: 'base32',
      });

      const res = await request(app.getHttpServer())
        .post('/auth/2fa/authenticate')
        .send({ token: code, tempToken })
        .expect(200);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body.user.email).toBe(twoFaUser.email);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const refreshCookie = pickSetCookie(cookies, 'refreshToken');
      expect(refreshCookie).toBeDefined();
      const csrfCookie = pickSetCookie(cookies, 'csrf-token');
      expect(csrfCookie).toBeDefined();
    });

    it('rejects an invalid 2FA code', async () => {
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: twoFaUser.email, password: twoFaUser.password })
        .expect(200);
      const tempToken = loginRes.body.tempToken as string;

      await request(app.getHttpServer())
        .post('/auth/2fa/authenticate')
        .send({ token: '000000', tempToken })
        .expect(401);
    });

    it('rejects a forged/expired tempToken', async () => {
      await request(app.getHttpServer())
        .post('/auth/2fa/authenticate')
        .send({ token: '123456', tempToken: 'forged-temp-token' })
        .expect(401);
    });
  });

  describe('Session revocation & access token invalidation', () => {
    // L'utilisateur testUser finit la suite reset-password avec ce mot de passe.
    const PASSWORD = 'FinalPass123!';

    async function login() {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testUser.email, password: PASSWORD })
        .expect(200);
      return {
        accessToken: res.body.accessToken as string,
        refreshCookie: (pickSetCookie(res.headers['set-cookie'], 'refreshToken') ?? '').split(
          ';',
        )[0],
      };
    }

    async function listSessions(token: string) {
      const res = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body as Array<Record<string, unknown>>;
    }

    it('GET /auth/sessions ne renvoie AUCUN champ sensible et marque la session courante', async () => {
      const { accessToken } = await login();
      const sessions = await listSessions(accessToken);
      expect(sessions.length).toBeGreaterThan(0);
      for (const s of sessions) {
        expect(s).not.toHaveProperty('refreshTokenHash');
        expect(s).not.toHaveProperty('previousRefreshTokenHash');
      }
      expect(sessions.filter((s) => s.isCurrent === true).length).toBe(1);
    });

    it("logout révoque l'access token de la session courante (session-scoped)", async () => {
      const { accessToken } = await login();
      const csrf = await fetchCsrf();
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .set('X-CSRF-HMAC', csrf.hmac)
        .expect(204);

      // L'access token de la session déconnectée est désormais refusé.
      await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);

      // Une nouvelle connexion fonctionne normalement.
      const fresh = await login();
      await listSessions(fresh.accessToken);
    });

    it("révoquer UNE session ne coupe PAS l'access token des autres appareils", async () => {
      const a = await login();
      const b = await login();

      const sessionsA = await listSessions(a.accessToken);
      const current = sessionsA.find((s) => s.isCurrent === true);
      expect(current).toBeDefined();

      const csrf = await fetchCsrf();
      await request(app.getHttpServer())
        .delete(`/auth/sessions/${current!.id}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .set('X-CSRF-HMAC', csrf.hmac)
        .expect(204);

      // Session A révoquée → access token mort.
      await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .expect(401);

      // Session B toujours vivante → son access token continue de fonctionner.
      await listSessions(b.accessToken);
    });

    it('revoke-all exclut la session courante mais tue les autres', async () => {
      const a = await login();
      const b = await login();

      const csrf = await fetchCsrf();
      await request(app.getHttpServer())
        .post('/auth/sessions/revoke-all')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('Cookie', csrf.cookie)
        .set('X-CSRF-Token', csrf.token)
        .set('X-CSRF-HMAC', csrf.hmac)
        .expect(204);

      // Session courante (A) : access token encore valide.
      await listSessions(a.accessToken);

      // Session B : access token révoqué.
      await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .expect(401);

      // Refresh token de B : session supprimée en base → refusé aussi.
      const csrfB = await fetchCsrf();
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `${b.refreshCookie}; ${csrfB.cookie}`)
        .set('X-CSRF-Token', csrfB.token)
        .set('X-CSRF-HMAC', csrfB.hmac)
        .expect(401);
    });
  });
});
