import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from './audit-log.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
  },
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService(mockPrisma as unknown as PrismaService);
  });

  it('persists a typed audit event with request metadata', async () => {
    const params = {
      userId: 'user-1',
      companyId: 'company-1',
      action: AuditAction.profile_update,
      metadata: { field: 'firstName' },
      ip: '127.0.0.1',
      userAgent: 'Chrome',
    };
    mockPrisma.auditLog.create.mockResolvedValueOnce({ id: 'audit-1', ...params });

    await expect(service.log(params)).resolves.toMatchObject({ id: 'audit-1' });
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({ data: params });
  });

  it('finds user audit events newest first', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([{ id: 'audit-1' }]);

    await expect(service.findByUser('user-1', 5)).resolves.toEqual([{ id: 'audit-1' }]);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });

  it('finds company audit events with user identity summary', async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([{ id: 'audit-1' }]);

    await expect(service.findByCompany('company-1', 25)).resolves.toEqual([{ id: 'audit-1' }]);
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1' },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  });
});
