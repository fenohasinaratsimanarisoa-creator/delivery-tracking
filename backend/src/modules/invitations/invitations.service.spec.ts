import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { InvitationsService } from './invitations.service';

jest.mock('bcrypt');

const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  invitation: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockEmailService = {
  sendInvitation: jest.fn(),
};

describe('InvitationsService', () => {
  let service: InvitationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.alloc(32, 1) as never);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    mockEmailService.sendInvitation.mockResolvedValue(undefined);
    service = new InvitationsService(
      mockPrisma as unknown as PrismaService,
      mockEmailService as unknown as EmailService,
    );
  });

  describe('create', () => {
    const dto = { email: 'driver@test.com', role: UserRole.driver };

    it('creates a pending invitation and sends an invite email', async () => {
      const invitation = { id: 'inv-1', ...dto, token: 'token' };
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.invitation.findFirst.mockResolvedValueOnce(null);
      mockPrisma.invitation.create.mockResolvedValueOnce(invitation);

      await expect(service.create('company-1', 'admin-1', dto)).resolves.toEqual(invitation);
      expect(mockPrisma.invitation.create).toHaveBeenCalledWith({
        data: {
          email: 'driver@test.com',
          role: UserRole.driver,
          token: expect.any(String),
          companyId: 'company-1',
          invitedById: 'admin-1',
          expiresAt: expect.any(Date),
        },
      });
      expect(mockEmailService.sendInvitation).toHaveBeenCalledWith(
        'driver@test.com',
        expect.stringMatching(/\/auth\/invite\//),
        UserRole.driver,
      );
    });

    it('rejects an invitation for an existing active company user', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce({ id: 'user-1' });

      await expect(service.create('company-1', 'admin-1', dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate pending invitations', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);
      mockPrisma.invitation.findFirst.mockResolvedValueOnce({ id: 'inv-1' });

      await expect(service.create('company-1', 'admin-1', dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
    });
  });

  it('lists invitations with inviter summary', async () => {
    mockPrisma.invitation.findMany.mockResolvedValueOnce([{ id: 'inv-1' }]);

    await expect(service.findAll('company-1')).resolves.toEqual([{ id: 'inv-1' }]);
    expect(mockPrisma.invitation.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      orderBy: { createdAt: 'desc' },
      include: {
        invitedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  });

  describe('findByToken', () => {
    it('returns a valid pending invitation', async () => {
      const invitation = {
        id: 'inv-1',
        token: 'token',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000),
      };
      mockPrisma.invitation.findUnique.mockResolvedValueOnce(invitation);

      await expect(service.findByToken('token')).resolves.toEqual(invitation);
    });

    it('throws when token is unknown', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValueOnce(null);

      await expect(service.findByToken('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws when invitation was already used', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 60_000),
      });

      await expect(service.findByToken('token')).rejects.toThrow(BadRequestException);
    });

    it('marks expired invitations before rejecting them', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValueOnce({
        id: 'inv-1',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000),
      });

      await expect(service.findByToken('token')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'expired' },
      });
    });
  });

  it('accepts an invitation by creating a user and marking it accepted', async () => {
    const invitation = {
      id: 'inv-1',
      email: 'driver@test.com',
      role: UserRole.driver,
      companyId: 'company-1',
      status: 'pending',
      expiresAt: new Date(Date.now() + 60_000),
    };
    const user = { id: 'user-1', email: 'driver@test.com' };
    mockPrisma.invitation.findUnique.mockResolvedValueOnce(invitation);
    mockPrisma.user.create.mockResolvedValueOnce(user);

    await expect(
      service.accept('token', {
        password: 'StrongPass123!',
        firstName: 'Alice',
        lastName: 'Driver',
        phone: '+261000000',
      }),
    ).resolves.toEqual(user);
    expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass123!', 12);
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: 'driver@test.com',
        passwordHash: 'hashed-password',
        firstName: 'Alice',
        lastName: 'Driver',
        phone: '+261000000',
        role: UserRole.driver,
        companyId: 'company-1',
      },
    });
    expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { status: 'accepted', acceptedAt: expect.any(Date) },
    });
  });

  describe('resend', () => {
    it('rotates token and expiry for a pending invitation', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValueOnce({
        id: 'inv-1',
        email: 'driver@test.com',
        role: UserRole.driver,
        status: 'pending',
      });

      await expect(service.resend('company-1', 'inv-1')).resolves.toEqual({
        message: 'Invitation resent successfully',
      });
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { token: expect.any(String), expiresAt: expect.any(Date) },
      });
      expect(mockEmailService.sendInvitation).toHaveBeenCalled();
    });

    it('rejects resending a non-pending invitation', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValueOnce({
        id: 'inv-1',
        status: 'accepted',
      });

      await expect(service.resend('company-1', 'inv-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('revoke', () => {
    it('marks a pending invitation as revoked', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValueOnce({
        id: 'inv-1',
        status: 'pending',
      });

      await expect(service.revoke('company-1', 'inv-1')).resolves.toEqual({
        message: 'Invitation revoked successfully',
      });
      expect(mockPrisma.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'revoked' },
      });
    });

    it('throws when invitation does not exist in company scope', async () => {
      mockPrisma.invitation.findFirst.mockResolvedValueOnce(null);

      await expect(service.revoke('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
