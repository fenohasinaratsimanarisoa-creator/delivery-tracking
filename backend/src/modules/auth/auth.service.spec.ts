import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { TotpService } from './totp.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Verify2faDto } from './dto/two-factor.dto';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  hashSync: jest.fn().mockReturnValue('$2b$10$dummyHashForTimingAttackMitigation'),
  compare: jest.fn(),
}));

const mockTx = {
  company: { create: jest.fn() },
  user: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  userSession: { deleteMany: jest.fn() },
  invitation: { update: jest.fn() },
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  company: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
  userSession: {
    create: jest.fn(),
    deleteMany: jest.fn(),
  },
  invitation: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((cb: (tx: typeof mockTx) => unknown) => cb(mockTx)),
};

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
};

const mockEmailService = {
  sendWelcome: jest.fn(),
  sendPasswordReset: jest.fn(),
};

const mockTotpService = {
  verifyToken: jest.fn(),
  generateSecret: jest.fn(),
};

const mockAuditLog = {
  log: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest
      .spyOn(crypto, 'randomBytes')
      .mockReturnValue(
        Buffer.from('6d6f636b5f746f6b656e5f70616464696e675f686572655f', 'hex') as any,
      );

    mockConfigService.get.mockImplementation((key: string, defaultValue?: string) => {
      const config: Record<string, string> = {
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
        JWT_2FA_TEMP_SECRET: 'temp-token-secret',
        JWT_ACCESS_EXPIRATION: '15m',
        JWT_REFRESH_EXPIRATION: '7d',
      };
      return config[key] ?? defaultValue;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: TotpService, useValue: mockTotpService },
        { provide: AuditLogService, useValue: mockAuditLog },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'test@test.com',
      password: 'StrongPass123!',
      firstName: 'John',
      lastName: 'Doe',
      companyName: 'My Company',
      phone: undefined,
    };

    it('should create a user and company, return tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_password');
      mockTx.company.create.mockResolvedValueOnce({ id: 'comp-1' });
      mockTx.user.create.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
        companyId: 'comp-1',
      });
      mockEmailService.sendWelcome.mockResolvedValueOnce(undefined);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        });
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.register(dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass123!', 12);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTx.company.create).toHaveBeenCalledWith({
        data: { name: 'My Company' },
      });
      expect(mockTx.user.create).toHaveBeenCalledWith({
        data: {
          email: 'test@test.com',
          passwordHash: 'hashed_password',
          firstName: 'John',
          lastName: 'Doe',
          phone: undefined,
          role: 'admin',
          companyId: 'comp-1',
        },
      });
      expect(mockEmailService.sendWelcome).toHaveBeenCalledWith('test@test.com', 'John');
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        },
      });
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const dto: LoginDto = {
      email: 'test@test.com',
      password: 'ValidPass123!',
    };

    const baseUser = {
      id: 'user-1',
      email: 'test@test.com',
      passwordHash: 'hashed_password',
      firstName: 'John',
      lastName: 'Doe',
      role: 'admin',
      companyId: 'comp-1',
      isActive: true,
      totpEnabled: false,
      totpSecret: null,
    };

    it('should return tokens when credentials are valid (no 2FA)', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true); // timing dummy
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true); // actual validation
      mockPrisma.userSession.create.mockResolvedValueOnce({ id: 'session-1' });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        });
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.login(dto, '127.0.0.1', 'Chrome');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'test@test.com', deletedAt: null },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith('ValidPass123!', 'hashed_password');
      expect(mockPrisma.userSession.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          device: 'Chrome',
          ip: '127.0.0.1',
          expiresAt: expect.any(Date),
        },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: 'comp-1',
        action: 'login_success',
        ip: '127.0.0.1',
        userAgent: 'Chrome',
      });
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        },
      });
    });

    it('should throw UnauthorizedException when user is not found (timing-safe)', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).toHaveBeenCalledWith('ValidPass123!', expect.any(String));
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: null,
        companyId: null,
        action: 'login_failed',
        metadata: { reason: 'user_not_found' },
        ip: undefined,
        userAgent: undefined,
      });
    });

    it('should throw UnauthorizedException when user is inactive (timing-safe)', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({
        ...baseUser,
        isActive: false,
      });

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
      expect(bcrypt.compare).toHaveBeenCalledWith('ValidPass123!', expect.any(String));
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: 'comp-1',
        action: 'login_failed',
        metadata: { reason: 'account_inactive' },
        ip: undefined,
        userAgent: undefined,
      });
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(baseUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.login(dto)).rejects.toThrow(UnauthorizedException);
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: 'comp-1',
        action: 'login_failed',
        metadata: { reason: 'invalid_password' },
        ip: undefined,
        userAgent: undefined,
      });
    });

    it('should return tempToken when 2FA is enabled', async () => {
      const userWith2fa = {
        ...baseUser,
        totpEnabled: true,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(userWith2fa);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true); // timing dummy
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true); // actual validation
      mockPrisma.userSession.create.mockResolvedValueOnce({ id: 'session-1' });
      mockJwtService.sign.mockReturnValueOnce('temp_token_value');

      const result = await service.login(dto, undefined, undefined);

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        { sub: 'user-1', scope: '2fa_pending' },
        {
          secret: 'temp-token-secret',
          expiresIn: '5m',
        },
      );
      expect(result).toEqual({
        accessToken: '',
        refreshToken: '',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        },
        requiresTwoFactor: true,
        tempToken: 'temp_token_value',
      });
    });
  });

  describe('verify2faToken', () => {
    const dto: Verify2faDto = {
      tempToken: 'valid_temp_token',
      token: '123456',
    };

    const baseUser = {
      id: 'user-1',
      email: 'test@test.com',
      role: 'admin',
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      isActive: true,
      totpEnabled: true,
      totpSecret: 'base32secret',
    };

    it('should return tokens when 2FA code is valid', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-1',
        scope: '2fa_pending',
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
      mockTotpService.verifyToken.mockReturnValueOnce(true);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        });
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.verify2faToken(dto);

      expect(mockJwtService.verify).toHaveBeenCalledWith('valid_temp_token', {
        secret: 'temp-token-secret',
      });
      expect(mockTotpService.verifyToken).toHaveBeenCalledWith('base32secret', '123456');
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        },
      });
    });

    it('should throw UnauthorizedException when temp token is invalid', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      await expect(service.verify2faToken(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token scope is wrong', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-1',
        scope: 'something_else',
      });

      await expect(service.verify2faToken(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user not found or 2FA not enabled', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-1',
        scope: '2fa_pending',
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.verify2faToken(dto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when 2FA code is invalid', async () => {
      mockJwtService.verify.mockReturnValueOnce({
        sub: 'user-1',
        scope: '2fa_pending',
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
      mockTotpService.verifyToken.mockReturnValueOnce(false);

      await expect(service.verify2faToken(dto)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    const refreshToken = 'valid_refresh_token';

    it('should return new tokens when refresh token is valid', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      mockTx.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        role: 'admin',
        companyId: 'comp-1',
        firstName: 'John',
        lastName: 'Doe',
        isActive: true,
        refreshTokenHash: 'stored_hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'John', lastName: 'Doe' })
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        });
      mockJwtService.sign
        .mockReturnValueOnce('new_access_token')
        .mockReturnValueOnce('new_refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('new_hashed_refresh');

      const result = await service.refresh(refreshToken, '10.0.0.1', 'Firefox');

      expect(mockJwtService.verify).toHaveBeenCalledWith(refreshToken, {
        secret: 'refresh-secret',
      });
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockTx.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          role: true,
          companyId: true,
          firstName: true,
          lastName: true,
          isActive: true,
          refreshTokenHash: true,
          totpEnabled: true,
        },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(refreshToken, 'stored_hash');
      expect(result).toEqual({
        accessToken: 'new_access_token',
        refreshToken: 'new_refresh_token',
        user: {
          id: 'user-1',
          email: 'test@test.com',
          firstName: 'John',
          lastName: 'Doe',
          role: 'admin',
          companyId: 'comp-1',
        },
      });
    });

    it('should throw UnauthorizedException when JWT verification fails', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is not found in transaction', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      mockTx.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on reuse and revoke sessions', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'user-1' });
      mockTx.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        isActive: true,
        refreshTokenHash: 'stored_hash',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);

      expect(mockTx.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
    });
  });

  describe('logout', () => {
    it('should clear refreshTokenHash for the user', async () => {
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        refreshTokenHash: null,
      });

      await service.logout('user-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
    });
  });

  describe('forgotPassword', () => {
    it('should send reset email with combined token when user exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
      });
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_reset_token');
      mockPrisma.user.update.mockResolvedValueOnce({ id: 'user-1' });
      mockEmailService.sendPasswordReset.mockResolvedValueOnce(undefined);

      jest.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000001');

      await service.forgotPassword('test@test.com');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
      expect(crypto.randomBytes).toHaveBeenCalledWith(48);
      expect(bcrypt.hash).toHaveBeenCalledWith(
        '6d6f636b5f746f6b656e5f70616464696e675f686572655f',
        10,
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          resetTokenId: '00000000-0000-4000-8000-000000000001',
          resetTokenHash: 'hashed_reset_token',
          resetTokenExpiry: expect.any(Date),
        },
      });
      expect(mockEmailService.sendPasswordReset).toHaveBeenCalledWith(
        'test@test.com',
        '00000000-0000-4000-8000-000000000001:6d6f636b5f746f6b656e5f70616464696e675f686572655f',
      );
    });

    it('should silently return when user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await service.forgotPassword('unknown@test.com');

      expect(bcrypt.hash).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    const resetTokenId = '00000000-0000-4000-8000-000000000001';
    const rawSecret = 'raw-secret-456';
    const combinedToken = `${resetTokenId}:${rawSecret}`;
    const newPassword = 'NewStrongPass123!';

    it('should reset password via indexed resetTokenId lookup (O(1))', async () => {
      const user = {
        id: 'user-1',
        resetTokenHash: 'hashed_secret',
        resetTokenExpiry: new Date(Date.now() + 3600000),
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('new_hashed_password');
      mockPrisma.user.update.mockResolvedValueOnce({ id: 'user-1' });

      await service.resetPassword(combinedToken, newPassword);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { resetTokenId },
      });
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith(rawSecret, 'hashed_secret');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new_hashed_password',
          resetTokenId: null,
          resetTokenHash: null,
          resetTokenExpiry: null,
          refreshTokenHash: null,
        },
      });
    });

    it('should throw BadRequestException when combined token has no colon separator', async () => {
      await expect(service.resetPassword('no-colon', newPassword)).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when resetTokenId not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.resetPassword(combinedToken, newPassword)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when token is expired', async () => {
      const user = {
        id: 'user-1',
        resetTokenHash: 'hashed_secret',
        resetTokenExpiry: new Date(Date.now() - 3600000),
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);

      await expect(service.resetPassword(combinedToken, newPassword)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when secret is invalid', async () => {
      const user = {
        id: 'user-1',
        resetTokenHash: 'hashed_secret',
        resetTokenExpiry: new Date(Date.now() + 3600000),
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.resetPassword(combinedToken, newPassword)).rejects.toThrow(BadRequestException);
    });
  });

  describe('validateGoogleUser', () => {
    const profile = {
      googleId: 'google-123',
      email: 'user@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
    };

    const baseUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'dispatcher',
      companyId: 'comp-1',
      firstName: 'Jane',
      lastName: 'Smith',
      isActive: true,
    };

    it('should return tokens for existing googleId user', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(baseUser);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'Jane', lastName: 'Smith' })
        .mockResolvedValueOnce(baseUser);
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.validateGoogleUser(profile);

      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { googleId: 'google-123' },
      });
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: baseUser,
      });
    });

    it('should link googleId to existing email user and return tokens', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(baseUser);
      mockPrisma.user.update.mockResolvedValueOnce({
        ...baseUser,
        googleId: 'google-123',
      });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'Jane', lastName: 'Smith' })
        .mockResolvedValueOnce(baseUser);
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.validateGoogleUser(profile);

      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'user@example.com' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { googleId: 'google-123' },
      });
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: baseUser,
      });
    });

    it('should throw UnauthorizedException when googleId user is inactive', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...baseUser,
        isActive: false,
      });

      await expect(service.validateGoogleUser(profile)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when email user is inactive', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...baseUser, isActive: false });

      await expect(service.validateGoogleUser(profile)).rejects.toThrow(UnauthorizedException);
    });

    it('should create OWN new company when no pending invitation exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.invitation.findFirst.mockResolvedValueOnce(null);
      const newCompany = { id: 'new-company-id', name: 'Jane Smith', email: 'user@example.com' };
      mockPrisma.company.create.mockResolvedValueOnce(newCompany);
      const createdUser = {
        id: 'user-2',
        email: 'user@example.com',
        role: 'admin',
        companyId: 'new-company-id',
        firstName: 'Jane',
        lastName: 'Smith',
      };
      mockPrisma.user.create.mockResolvedValueOnce(createdUser);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'Jane', lastName: 'Smith' })
        .mockResolvedValueOnce(createdUser);
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.validateGoogleUser(profile);

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
        where: { email: 'user@example.com', status: 'pending', expiresAt: { gte: expect.any(Date) } },
        include: { company: true },
      });
      expect(mockPrisma.company.create).toHaveBeenCalledWith({
        data: { name: 'Jane Smith', email: 'user@example.com' },
      });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'new-company-id',
            role: 'admin',
          }),
        }),
      );
      expect(result).toEqual({
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        user: createdUser,
      });
    });

    it('should NOT attach to company A (same domain) when no invitation exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.invitation.findFirst.mockResolvedValueOnce(null);
      const newCompany = { id: 'new-company-id', name: 'Jane Smith', email: 'user@example.com' };
      mockPrisma.company.create.mockResolvedValueOnce(newCompany);
      const createdUser = {
        id: 'user-new',
        email: 'user@example.com',
        role: 'admin',
        companyId: 'new-company-id',
      };
      mockPrisma.user.create.mockResolvedValueOnce(createdUser);
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'Jane', lastName: 'Smith' })
        .mockResolvedValueOnce(createdUser);
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.validateGoogleUser(profile);

      expect(mockPrisma.company.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.company.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Jane Smith' }) }),
      );
      expect(result.user.companyId).toBe('new-company-id');
    });

    it('should join existing company via invitation when pending invitation exists', async () => {
      const companyA = { id: 'comp-a', name: 'Acme Inc', email: 'alice@acme.com' };
      const pendingInvitation = {
        id: 'inv-1',
        email: 'user@example.com',
        role: 'dispatcher',
        companyId: 'comp-a',
        company: companyA,
        status: 'pending',
        expiresAt: new Date(Date.now() + 86400000),
      };
      mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockPrisma.invitation.findFirst.mockResolvedValueOnce(pendingInvitation);
      const createdUser = {
        id: 'user-invited',
        email: 'user@example.com',
        role: 'dispatcher',
        companyId: 'comp-a',
      };
      mockPrisma.user.create.mockResolvedValueOnce(createdUser);
      mockPrisma.invitation.update.mockResolvedValueOnce({ ...pendingInvitation, status: 'accepted' });
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ firstName: 'Jane', lastName: 'Smith' })
        .mockResolvedValueOnce(createdUser);
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.validateGoogleUser(profile);

      expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
        where: { email: 'user@example.com', status: 'pending', expiresAt: { gte: expect.any(Date) } },
        include: { company: true },
      });
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'comp-a',
            role: 'dispatcher',
          }),
        }),
      );
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'accepted', acceptedAt: expect.any(Date) },
      });
      expect(result.user.companyId).toBe('comp-a');
    });
  });
});
