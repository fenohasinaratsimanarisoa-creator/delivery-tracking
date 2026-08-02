import { Test, TestingModule } from '@nestjs/testing';
import { DigestService } from './digest.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

const mockPrisma = {
  company: {
    findMany: jest.fn(),
  },
  delivery: {
    findMany: jest.fn(),
  },
  fuelLog: {
    findMany: jest.fn(),
  },
};

const mockEmailService = {
  sendDigest: jest.fn(),
};

const mockNotificationsService = {
  getDigestNotifications: jest.fn().mockResolvedValue({
    critical: [],
    high: [],
    medium: [],
    low: [],
    total: 0,
  }),
};

describe('DigestService', () => {
  let service: DigestService;
  let prisma: PrismaService;
  let emailService: EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-21T12:00:00.000Z'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
      ],
    }).compile();

    service = module.get<DigestService>(DigestService);
    prisma = module.get<PrismaService>(PrismaService);
    emailService = module.get<EmailService>(EmailService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('sendWeeklyDigest', () => {
    it('should send digest to admin and dispatcher users for each company', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Company One',
          users: [
            {
              id: 'user-1',
              email: 'admin@comp1.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
            {
              id: 'user-2',
              email: 'dispatcher@comp1.com',
              firstName: 'Dispatcher',
              role: 'dispatcher',
              isActive: true,
            },
            {
              id: 'user-3',
              email: 'driver@comp1.com',
              firstName: 'Driver',
              role: 'driver',
              isActive: true,
            },
          ],
        },
        {
          id: 'comp-2',
          name: 'Company Two',
          users: [
            {
              id: 'user-4',
              email: 'admin@comp2.com',
              firstName: 'Admin2',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValue([]);
      mockPrisma.fuelLog.findMany.mockResolvedValue([]);

      await service.sendWeeklyDigest();

      expect(mockPrisma.company.findMany).toHaveBeenCalledWith({
        include: {
          users: {
            where: { role: { in: ['admin', 'dispatcher'] }, isActive: true },
          },
        },
      });

      expect(mockEmailService.sendDigest).toHaveBeenCalledTimes(4);
    });

    it('should calculate delivery stats correctly', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      const deliveries = [
        { id: 'd1', status: 'delivered' },
        { id: 'd2', status: 'delivered' },
        { id: 'd3', status: 'failed' },
        { id: 'd4', status: 'pending' },
        { id: 'd5', status: 'cancelled' },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce(deliveries);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);

      await service.sendWeeklyDigest();

      const call = mockEmailService.sendDigest.mock.calls[0];
      const data = call[2];

      expect(data.totalDeliveries).toBe(5);
      expect(data.delivered).toBe(2);
      expect(data.failed).toBe(1);
      expect(data.punctuality).toBe(40);
    });

    it('should handle 100% punctuality when no deliveries', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);

      await service.sendWeeklyDigest();

      const call = mockEmailService.sendDigest.mock.calls[0];
      const data = call[2];

      expect(data.totalDeliveries).toBe(0);
      expect(data.punctuality).toBe(100);
    });

    it('should include fuel anomalies', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      const fuelAnomalies = [
        {
          id: 'f1',
          consumptionAnomalyFlag: true,
          consumptionAnomalyReason: 'Consumption 20.00 L/100km deviates 150.0%',
          liters: 100,
          fillDate: new Date('2026-07-20'),
          vehicle: { licensePlate: 'AB-123-CD' },
        },
        {
          id: 'f2',
          gpsAnomalyFlag: true,
          gpsAnomalyReason: 'Distance saisie (400km) très supérieure à la distance GPS (100.0km)',
          liters: 50,
          fillDate: new Date('2026-07-19'),
          vehicle: { licensePlate: 'EF-456-GH' },
        },
        {
          id: 'f3',
          consumptionAnomalyFlag: false,
          gpsAnomalyFlag: false,
          liters: 60,
          fillDate: new Date('2026-07-18'),
          vehicle: { licensePlate: 'IJ-789-KL' },
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce(fuelAnomalies);

      await service.sendWeeklyDigest();

      const call = mockEmailService.sendDigest.mock.calls[0];
      const data = call[2];

      expect(data.pendingAnomalies).toBe(2);
      expect(data.anomalyDetails).toHaveLength(2);
      expect(data.anomalyDetails[0]).toEqual({
        vehicle: 'AB-123-CD',
        liters: 100,
        date: expect.any(String),
      });
    });

    it('should filter anomalies by createdAt within the week', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);

      await service.sendWeeklyDigest();

      expect(mockPrisma.fuelLog.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'comp-1',
          createdAt: { gte: new Date('2026-07-14T12:00:00.000Z') },
          OR: [{ consumptionAnomalyFlag: true }, { gpsAnomalyFlag: true }],
        },
        include: { vehicle: { select: { licensePlate: true } } },
      });
    });

    it('should filter deliveries by createdAt within the week', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);

      await service.sendWeeklyDigest();

      expect(mockPrisma.delivery.findMany).toHaveBeenCalledWith({
        where: {
          companyId: 'comp-1',
          createdAt: { gte: new Date('2026-07-14T12:00:00.000Z') },
        },
      });
    });

    it('should continue to next company if email fails', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Company One',
          users: [
            {
              id: 'user-1',
              email: 'admin@comp1.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
        {
          id: 'comp-2',
          name: 'Company Two',
          users: [
            {
              id: 'user-2',
              email: 'admin@comp2.com',
              firstName: 'Admin2',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValue([]);
      mockPrisma.fuelLog.findMany.mockResolvedValue([]);
      mockEmailService.sendDigest
        .mockRejectedValueOnce(new Error('Email failed'))
        .mockResolvedValueOnce(undefined);

      await expect(service.sendWeeklyDigest()).resolves.not.toThrow();
      expect(mockEmailService.sendDigest).toHaveBeenCalledTimes(2);
    });

    it('should log error when email fails', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);
      mockEmailService.sendDigest.mockRejectedValueOnce(new Error('SMTP error'));

      const loggerSpy = jest.spyOn(service['logger'], 'error');

      await service.sendWeeklyDigest();

      expect(loggerSpy).toHaveBeenCalledWith(
        'Failed to send digest for company comp-1',
        expect.any(Error),
      );
    });

    it('should format week range correctly', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Test Company',
          users: [
            {
              id: 'user-1',
              email: 'admin@test.com',
              firstName: 'Admin',
              role: 'admin',
              isActive: true,
            },
          ],
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);
      mockPrisma.delivery.findMany.mockResolvedValueOnce([]);
      mockPrisma.fuelLog.findMany.mockResolvedValueOnce([]);

      await service.sendWeeklyDigest();

      const call = mockEmailService.sendDigest.mock.calls[0];
      const data = call[2];

      expect(data.weekRange).toContain('juillet');
    });
  });
});
