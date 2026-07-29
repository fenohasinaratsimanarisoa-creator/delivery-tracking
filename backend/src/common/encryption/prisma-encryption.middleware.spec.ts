import { Test, TestingModule } from '@nestjs/testing';
import { PrismaEncryptionMiddleware } from './prisma-encryption.middleware';
import { EncryptionService } from './encryption.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PrismaEncryptionMiddleware', () => {
  let middleware: PrismaEncryptionMiddleware;
  let encryptionService: EncryptionService;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EncryptionService,
        PrismaEncryptionMiddleware,
        {
          provide: PrismaService,
          useValue: {
            $use: jest.fn(),
          },
        },
      ],
    }).compile();

    middleware = module.get<PrismaEncryptionMiddleware>(PrismaEncryptionMiddleware);
    encryptionService = module.get<EncryptionService>(EncryptionService);
    encryptionService.onApplicationBootstrap();
  });

  afterAll(() => {
    delete process.env.ENCRYPTION_KEY;
  });

  it('should register $use middleware on bootstrap', () => {
    const spy = jest.fn();
    const mw = new PrismaEncryptionMiddleware(
      { $use: spy } as unknown as PrismaService,
      encryptionService,
    );
    mw.onApplicationBootstrap();
    expect(spy).toHaveBeenCalled();
  });

  it('should encrypt and decrypt totpSecret', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptionService.encrypt(plaintext);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);

    const decrypted = encryptionService.decrypt(encrypted!);
    expect(decrypted).toBe(plaintext);
  });

  it('should return null for encrypt when no key is set', () => {
    const originalKey = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;

    const localService = new EncryptionService();
    localService.onApplicationBootstrap();
    const result = localService.encrypt('test');

    process.env.ENCRYPTION_KEY = originalKey;

    expect(result).toBeNull();
    expect(localService.isEnabled()).toBe(false);
  });

  it('should properly round-trip TOTP secrets for verification', () => {
    const secret = 'K5DTCABRGEZDGMZTGM4DIZBQ';
    const encrypted = encryptionService.encrypt(secret);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(secret);

    const decrypted = encryptionService.decrypt(encrypted!);
    expect(decrypted).toBe(secret);
  });
});
