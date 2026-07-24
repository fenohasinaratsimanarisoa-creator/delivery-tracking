import { CsrfGuard } from './csrf.guard';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

describe('CsrfGuard', () => {
  let guard: CsrfGuard;
  let configService: ConfigService;

  beforeEach(async () => {
    configService = { get: jest.fn().mockReturnValue('test-secret') } as any;
    guard = new CsrfGuard(configService);
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
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'GET', cookies: {}, headers: {} }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should allow HEAD and OPTIONS without tokens', () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        const ctx = {
          switchToHttp: () => ({
            getRequest: () => ({ method, cookies: {}, headers: {} }),
            getResponse: () => ({}),
          }),
        } as any;
        expect(guard.canActivate(ctx)).toBe(true);
      }
    });

    it('should throw on POST without tokens', () => {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', cookies: {}, headers: {} }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw on POST with missing header token', () => {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ method: 'POST', cookies: { 'csrf-token': 'abc' }, headers: {} }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw on POST with mismatched cookie/header tokens', () => {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            cookies: { 'csrf-token': 'abc' },
            headers: { 'x-csrf-token': 'def', 'x-csrf-hmac': 'xyz' },
          }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw on POST with invalid HMAC signature', () => {
      const { token } = CsrfGuard.generateToken('test-secret');
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            cookies: { 'csrf-token': token },
            headers: { 'x-csrf-token': token, 'x-csrf-hmac': 'invalid-hmac' },
          }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should pass POST with valid tokens and HMAC', () => {
      const { token, hmac } = CsrfGuard.generateToken('test-secret');
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            cookies: { 'csrf-token': token },
            headers: { 'x-csrf-token': token, 'x-csrf-hmac': hmac },
          }),
          getResponse: () => ({}),
        }),
      } as any;
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
