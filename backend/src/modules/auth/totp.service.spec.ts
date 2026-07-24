import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TotpService } from './totp.service';
import * as speakeasy from 'speakeasy';

describe('TotpService', () => {
  let service: TotpService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TotpService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('TestApp') } },
      ],
    }).compile();

    service = module.get<TotpService>(TotpService);
  });

  describe('generateSecret', () => {
    it('should generate a secret and QR code', async () => {
      const result = await service.generateSecret('user@test.com');
      expect(result.secret).toBeDefined();
      expect(result.secret.length).toBeGreaterThan(16);
      expect(result.otpauthUrl).toContain('TestApp');
      expect(result.otpauthUrl).toContain('user%40test.com');
      expect(result.qrCode).toBeDefined();
      expect(result.qrCode).toContain('data:image/png;base64');
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid TOTP token', () => {
      const secretData = speakeasy.generateSecret({ name: 'test' });
      const token = speakeasy.totp({ secret: secretData.base32, encoding: 'base32' });
      const result = service.verifyToken(secretData.base32, token);
      expect(result).toBe(true);
    });

    it('should reject an invalid TOTP token', () => {
      const secretData = speakeasy.generateSecret({ name: 'test' });
      const result = service.verifyToken(secretData.base32, '000000');
      expect(result).toBe(false);
    });
  });
});
