import { CsrfGuard, validateCsrfSecret } from './csrf.guard';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function mockCtx(overrides?: Record<string, any>): any {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => overrides?.request ?? { method: 'GET', cookies: {}, headers: {} },
      getResponse: () => overrides?.response ?? {},
    }),
  };
}

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let configService: ConfigService;
  let reflector: any;

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue('test-secret') } as any;
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
    guard = new CsrfGuard(configService, reflector);
  });

  describe('validateCsrfSecret', () => {
    function mockConfig(values: Record<string, string | undefined>): ConfigService {
      return { get: jest.fn((key: string, def?: string) => values[key] ?? def) } as any;
    }

    it('throws if COOKIE_DOMAIN is set with https APP_URL in production', () => {
      const cs = mockConfig({
        CSRF_SECRET: 'x'.repeat(64),
        NODE_ENV: 'production',
        COOKIE_DOMAIN: '.example.com',
        APP_URL: 'https://app.example.com',
      });
      expect(() => validateCsrfSecret(cs)).toThrow(/COOKIE_DOMAIN/);
    });

    it('does not throw when COOKIE_DOMAIN is unset (single-host prod, e.g. Contabo)', () => {
      const cs = mockConfig({
        CSRF_SECRET: 'x'.repeat(64),
        NODE_ENV: 'production',
        APP_URL: 'https://169-58-237-88.sslip.io',
      });
      expect(() => validateCsrfSecret(cs)).not.toThrow();
    });

    it('does not throw outside production even with COOKIE_DOMAIN set', () => {
      const cs = mockConfig({
        CSRF_SECRET: 'x'.repeat(64),
        NODE_ENV: 'development',
        COOKIE_DOMAIN: '.example.com',
        APP_URL: 'https://app.example.com',
      });
      expect(() => validateCsrfSecret(cs)).not.toThrow();
    });
  });

  describe('generateToken', () => {
    it('should generate a token and HMAC', () => {
      const result = CsrfGuard.generateToken('test-secret');
      expect(result.token).toBeDefined();
      expect(result.token.length).toBe(64);
      expect(result.hmac).toBeDefined();
      expect(result.hmac.length).toBe(64);
    });

    it('should produce different tokens each call', () => {
      const r1 = CsrfGuard.generateToken('test-secret');
      const r2 = CsrfGuard.generateToken('test-secret');
      expect(r1.token).not.toBe(r2.token);
    });
  });

  describe('canActivate', () => {
    it('should allow GET requests without tokens', () => {
      expect(guard.canActivate(mockCtx())).toBe(true);
    });

    it('should allow HEAD and OPTIONS without tokens', () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        expect(guard.canActivate(mockCtx({ request: { method, cookies: {}, headers: {} } }))).toBe(
          true,
        );
      }
    });

    it('should throw on POST without tokens', () => {
      expect(() =>
        guard.canActivate(mockCtx({ request: { method: 'POST', cookies: {}, headers: {} } })),
      ).toThrow(ForbiddenException);
    });

    it('should throw on POST with missing header token', () => {
      expect(() =>
        guard.canActivate(
          mockCtx({ request: { method: 'POST', cookies: { 'csrf-token': 'abc' }, headers: {} } }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('should throw on POST with mismatched cookie/header tokens', () => {
      expect(() =>
        guard.canActivate(
          mockCtx({
            request: {
              method: 'POST',
              cookies: { 'csrf-token': 'abc' },
              headers: { 'x-csrf-token': 'def', 'x-csrf-hmac': 'xyz' },
            },
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('should throw on POST with invalid HMAC signature', () => {
      const { token } = CsrfGuard.generateToken('test-secret');
      expect(() =>
        guard.canActivate(
          mockCtx({
            request: {
              method: 'POST',
              cookies: { 'csrf-token': token },
              headers: { 'x-csrf-token': token, 'x-csrf-hmac': 'invalid-hmac' },
            },
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('should pass POST with valid tokens and HMAC', () => {
      const { token, hmac } = CsrfGuard.generateToken('test-secret');
      expect(
        guard.canActivate(
          mockCtx({
            request: {
              method: 'POST',
              cookies: { 'csrf-token': token },
              headers: { 'x-csrf-token': token, 'x-csrf-hmac': hmac },
            },
          }),
        ),
      ).toBe(true);
    });

    it('should allow POST when SkipCsrf decorator is present', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      expect(
        guard.canActivate(mockCtx({ request: { method: 'POST', cookies: {}, headers: {} } })),
      ).toBe(true);
    });
  });
});
