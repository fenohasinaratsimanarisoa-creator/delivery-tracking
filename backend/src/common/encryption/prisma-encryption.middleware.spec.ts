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

  // Régression : le middleware encryptait autrefois seulement le PREMIER champ
  // sensible trouvé pour un modèle (`.find()`), laissant `totpSecret` en clair
  // pour `User` (qui a aussi `phone`). Ce test exerce directement le callback
  // $use avec un modèle à 2 champs sensibles pour verrouiller le comportement.
  describe('$use write path — plusieurs champs sensibles pour un même modèle', () => {
    async function captureUseCallback() {
      let callback: (params: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>;
      const fakePrisma = {
        $use: (cb: typeof callback) => {
          callback = cb;
        },
      };
      const mw = new PrismaEncryptionMiddleware(
        fakePrisma as unknown as PrismaService,
        encryptionService,
      );
      mw.onApplicationBootstrap();
      return callback!;
    }

    it('chiffre TOUS les champs sensibles (phone ET totpSecret) sur update User', async () => {
      const use = await captureUseCallback();
      const params = {
        model: 'User',
        action: 'update',
        args: { data: { phone: '+261340000000', totpSecret: 'JBSWY3DPEHPK3PXP' } },
      };
      const next = jest.fn().mockResolvedValue(null);

      await use(params, next);

      expect(params.args.data.phone).not.toBe('+261340000000');
      expect(params.args.data.totpSecret).not.toBe('JBSWY3DPEHPK3PXP');
      expect(encryptionService.decrypt(params.args.data.phone)).toBe('+261340000000');
      expect(encryptionService.decrypt(params.args.data.totpSecret)).toBe('JBSWY3DPEHPK3PXP');
    });

    it('chiffre les deux champs sensibles pour upsert (create ET update)', async () => {
      const use = await captureUseCallback();
      const params = {
        model: 'Company',
        action: 'upsert',
        args: {
          create: { phone: '+261340000001', address: 'Lot 1 Antananarivo' },
          update: { phone: '+261340000002', address: 'Lot 2 Antananarivo' },
        },
      };
      const next = jest.fn().mockResolvedValue(null);

      await use(params, next);

      expect(encryptionService.decrypt(params.args.create.phone)).toBe('+261340000001');
      expect(encryptionService.decrypt(params.args.create.address)).toBe('Lot 1 Antananarivo');
      expect(encryptionService.decrypt(params.args.update.phone)).toBe('+261340000002');
      expect(encryptionService.decrypt(params.args.update.address)).toBe('Lot 2 Antananarivo');
    });
  });
});
