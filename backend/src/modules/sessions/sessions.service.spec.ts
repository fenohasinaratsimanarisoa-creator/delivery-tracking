import { ForbiddenException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SessionsService } from './sessions.service';

const mockPrisma = {
  userSession: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockRedis = {
  set: jest.fn().mockResolvedValue('OK'),
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
      mockRedis as never,
    );
  });

  describe('findAll', () => {
    it('ne renvoie que les sessions NON expirées', async () => {
      mockPrisma.userSession.findMany.mockResolvedValueOnce([]);
      await service.findAll('user-1');
      expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', expiresAt: { gt: expect.any(Date) } },
        }),
      );
    });
  });

  describe('purgeExpiredSessions', () => {
    it('supprime les UserSession dont expiresAt est dépassé', async () => {
      mockPrisma.userSession.deleteMany.mockResolvedValueOnce({ count: 3 });
      await service.purgeExpiredSessions();
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('passe son tour si le verrou cron est tenu par une autre instance', async () => {
      mockRedis.set.mockResolvedValueOnce(null);
      await service.purgeExpiredSessions();
      expect(mockPrisma.userSession.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // RÉVOCATION SCOPÉE — le refreshTokenHash vit sur UserSession : la révocation
  // d'UNE session ne doit jamais toucher les autres appareils du même utilisateur.
  // ----------------------------------------------------------------
  describe('revokeSession', () => {
    it('Test B : purge le refreshTokenHash de la session ciblée et supprime CETTE ligne, sans affecter les autres sessions', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        id: 'session-1',
        userId: 'user-1',
        device: 'Chrome',
        ip: '10.0.0.1',
      });
      mockPrisma.userSession.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.userSession.delete.mockResolvedValueOnce({ id: 'session-1' });

      const res = await service.revokeSession('user-1', 'session-1', 'company-1');

      // Le hash est purgé sur CETTE session avant suppression de la ligne.
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1' },
        data: { refreshTokenHash: null },
      });
      expect(mockPrisma.userSession.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
      // Jamais de purge/delete massif sur userId : la session de l'appareil 2
      // reste intacte (son refresh continue de fonctionner).
      expect(mockPrisma.userSession.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.session_revoke }),
      );
      expect(res).toEqual({ message: 'Session revoked successfully' });
    });

    it('rejects revoking another user session (404/403, aucune écriture)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValueOnce({
        id: 'session-2',
        userId: 'user-2',
      });

      await expect(service.revokeSession('user-1', 'session-2', 'company-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.userSession.delete).not.toHaveBeenCalled();
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllSessions', () => {
    it('purge le refreshTokenHash des sessions révoquées, en préservant la session courante (exceptSessionId)', async () => {
      mockPrisma.userSession.findMany.mockResolvedValueOnce([
        { id: 'session-1' },
        { id: 'session-2' },
        { id: 'session-current' },
      ]);
      mockPrisma.userSession.updateMany.mockResolvedValueOnce({ count: 2 });
      mockPrisma.userSession.deleteMany.mockResolvedValueOnce({ count: 2 });

      await service.revokeAllSessions('user-1', 'company-1', 'session-current');

      // La purge concerne UNIQUEMENT les sessions effectivement supprimées.
      expect(mockPrisma.userSession.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['session-1', 'session-2'] } },
        data: { refreshTokenHash: null },
      });
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['session-1', 'session-2'] } },
      });
      expect(mockPrisma.userSession.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'session-current' }) }),
      );
    });
  });
});
