import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SessionsService } from './sessions.service';

const mockPrisma = {
  userSession: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  auditLog: {
    findMany: jest.fn(),
  },
};

const mockAuditLog = {
  log: jest.fn(),
};

describe('SessionsService', () => {
  let service: SessionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionsService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
    );
  });

  it('lists sessions ordered by latest activity', async () => {
    mockPrisma.userSession.findMany.mockResolvedValueOnce([{ id: 'session-1' }]);

    await expect(service.findAll('user-1')).resolves.toEqual([{ id: 'session-1' }]);
    expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { lastActivity: 'desc' },
    });
  });

  describe('revokeSession', () => {
    it('deletes a user-owned session and writes an audit event', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        device: 'Chrome',
        ip: '10.0.0.1',
      });

      await expect(
        service.revokeSession('user-1', 'session-1', 'company-1', '127.0.0.1', 'Firefox'),
      ).resolves.toEqual({ message: 'Session revoked successfully' });
      expect(mockPrisma.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: 'company-1',
        action: AuditAction.session_revoke,
        metadata: {
          sessionId: 'session-1',
          device: 'Chrome',
          ip: '10.0.0.1',
        },
        ip: '127.0.0.1',
        userAgent: 'Firefox',
      });
    });

    it('throws when the session does not exist', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValueOnce(null);

      await expect(service.revokeSession('user-1', 'missing', 'company-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('prevents revoking another user session', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'other-user',
      });

      await expect(service.revokeSession('user-1', 'session-1', 'company-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.userSession.delete).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions', () => {
    it('revokes every session except the requested current one', async () => {
      mockPrisma.userSession.findMany.mockResolvedValueOnce([
        { id: 'current' },
        { id: 'old-1' },
        { id: 'old-2' },
      ]);

      await expect(
        service.revokeAllSessions('user-1', 'company-1', 'current', '127.0.0.1', 'Chrome'),
      ).resolves.toEqual({ message: '2 session(s) revoked' });
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['old-1', 'old-2'] } },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith({
        userId: 'user-1',
        companyId: 'company-1',
        action: AuditAction.session_revoke,
        metadata: { revokedCount: 2, exceptSessionId: 'current' },
        ip: '127.0.0.1',
        userAgent: 'Chrome',
      });
    });

    it('still audits when there is nothing to revoke', async () => {
      mockPrisma.userSession.findMany.mockResolvedValueOnce([{ id: 'current' }]);

      await expect(service.revokeAllSessions('user-1', 'company-1', 'current')).resolves.toEqual({
        message: '0 session(s) revoked',
      });
      expect(mockPrisma.userSession.deleteMany).not.toHaveBeenCalled();
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { revokedCount: 0, exceptSessionId: 'current' } }),
      );
    });
  });

  it('returns login history from user sessions, newest first, with ip/device', async () => {
    const sessions = [
      {
        createdAt: new Date('2026-07-22T08:00:00.000Z'),
        ip: '10.0.0.9',
        device: 'Chrome',
        lastActivity: new Date('2026-07-22T09:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-07-21T08:00:00.000Z'),
        ip: '10.0.0.1',
        device: 'Firefox',
        lastActivity: new Date('2026-07-21T09:00:00.000Z'),
      },
    ];
    mockPrisma.userSession.findMany.mockResolvedValueOnce(sessions);

    const result = await service.getLoginHistory('user-1', 5);

    console.log(
      `[loginHistory] ${result.length} sessions, première : createdAt=${result[0].createdAt.toISOString()}, ip=${result[0].ip}, device=${result[0].device}`,
    );

    expect(result).toEqual(sessions);
    expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { createdAt: true, ip: true, device: true, lastActivity: true },
    });
    // L'AuditLog n'est plus utilisé pour l'historique de connexion.
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});
