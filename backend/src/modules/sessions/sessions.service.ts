import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '@prisma/client';

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async findAll(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { lastActivity: 'desc' },
    });
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    companyId: string,
    ip?: string,
    userAgent?: string,
  ) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException("Cannot revoke another user's session");
    }

    // Purge d'abord le refreshTokenHash de CETTE session (les autres appareils
    // connectés gardent le leur) puis supprime la ligne UserSession.
    await this.prisma.userSession.updateMany({
      where: { id: sessionId },
      data: { refreshTokenHash: null },
    });
    await this.prisma.userSession.delete({
      where: { id: sessionId },
    });

    await this.auditLog.log({
      userId,
      companyId,
      action: AuditAction.session_revoke,
      metadata: { sessionId, device: session.device, ip: session.ip },
      ip,
      userAgent,
    });

    return { message: 'Session revoked successfully' };
  }

  async revokeAllSessions(
    userId: string,
    companyId: string,
    exceptSessionId?: string,
    ip?: string,
    userAgent?: string,
  ) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId },
    });

    const toDelete = sessions.filter((s) => s.id !== exceptSessionId);

    if (toDelete.length > 0) {
      // Purge le refreshTokenHash des sessions ciblées AVANT suppression : même si
      // la ligne est effacée juste après, aucune session survivante (celle exclue)
      // n'est touchée.
      await this.prisma.userSession.updateMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
        data: { refreshTokenHash: null },
      });
      await this.prisma.userSession.deleteMany({
        where: { id: { in: toDelete.map((s) => s.id) } },
      });
    }

    await this.auditLog.log({
      userId,
      companyId,
      action: AuditAction.session_revoke,
      metadata: { revokedCount: toDelete.length, exceptSessionId },
      ip,
      userAgent,
    });

    return { message: `${toDelete.length} session(s) revoked` };
  }

  async getLoginHistory(userId: string, limit = 50) {
    // Historique de connexions : chaque UserSession correspond à une session
    // ouverte à la connexion, avec createdAt/ip/device. L'AuditLog ne convient pas
    // ici — aucune valeur AuditAction ne représente un événement de connexion
    // (session_revoke est une déconnexion, pas une connexion).
    return this.prisma.userSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { createdAt: true, ip: true, device: true, lastActivity: true },
    });
  }
}
