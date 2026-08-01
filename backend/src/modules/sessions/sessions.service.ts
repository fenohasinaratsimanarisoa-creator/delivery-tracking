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
    // This could be from audit logs or a separate login history table
    return this.prisma.auditLog.findMany({
      where: {
        userId,
        action: { in: [AuditAction.session_revoke] }, // We'll expand this
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
