import { EmailService } from './email.service';
import { ConfigService } from '@nestjs/config';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }),
    },
  })),
}));

const mockConfigService = {
  get: jest.fn(),
};

describe('EmailService', () => {
  let service: EmailService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      const config: Record<string, string> = {
        RESEND_API_KEY: 're_test_key',
        EMAIL_FROM: 'noreply@test.com',
        APP_URL: 'http://localhost:3000',
      };
      return config[key];
    });

    service = new EmailService(mockConfigService as unknown as ConfigService);
  });

  describe('sendPasswordReset', () => {
    it('should send password reset email with correct link', async () => {
      const token = 'reset-token-123';
      const email = 'user@test.com';

      await service.sendPasswordReset(email, token);

      const resend = (service as any).resend;
      expect(resend.emails.send).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: email,
        subject: 'Réinitialisation de mot de passe — DeliveryTrack',
        html: expect.stringContaining('http://localhost:3000/reset-password?token=reset-token-123'),
      });
    });

    it('should log and not throw when Resend is not configured', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'RESEND_API_KEY') return undefined;
        return 'default';
      });

      const serviceWithoutResend = new EmailService(mockConfigService as unknown as ConfigService);
      const loggerSpy = jest.spyOn(serviceWithoutResend['logger'], 'log');

      await serviceWithoutResend.sendPasswordReset('test@test.com', 'token');

      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL LOG]'));
    });
  });

  describe('sendInvitation', () => {
    it('should send invitation email with role', async () => {
      const email = 'invitee@test.com';
      const inviteUrl = 'http://localhost:3000/invite/token';
      const role = 'dispatcher';

      await service.sendInvitation(email, inviteUrl, role);

      const resend = (service as any).resend;
      expect(resend.emails.send).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: email,
        subject: 'Invitation — DeliveryTrack',
        html: expect.stringContaining(role),
      });
    });
  });

  describe('sendDigest', () => {
    it('should send digest email with stats', async () => {
      const data = {
        companyName: 'Test Company',
        weekRange: '15 juillet — 21 juillet',
        totalDeliveries: 50,
        delivered: 45,
        failed: 3,
        punctuality: 90,
        pendingAnomalies: 2,
        anomalyDetails: [
          { vehicle: 'ABC-123', liters: 50, date: '2026-07-15' },
          { vehicle: 'DEF-456', liters: 45, date: '2026-07-18' },
        ],
        notificationCount: 3,
        notificationCritical: 0,
        notificationHigh: 1,
        notificationMedium: 2,
        notificationLow: 0,
      };

      await service.sendDigest('admin@test.com', 'Admin', data);

      const resend = (service as any).resend;
      expect(resend.emails.send).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: 'admin@test.com',
        subject: expect.stringContaining('Rapport hebdomadaire'),
        html: expect.stringContaining('Test Company'),
      });
    });

    it('should include anomaly rows in digest', async () => {
      const data = {
        companyName: 'Test Company',
        weekRange: '15 juillet — 21 juillet',
        totalDeliveries: 10,
        delivered: 8,
        failed: 1,
        punctuality: 80,
        pendingAnomalies: 1,
        anomalyDetails: [{ vehicle: 'ABC-123', liters: 50, date: '2026-07-15' }],
        notificationCount: 0,
        notificationCritical: 0,
        notificationHigh: 0,
        notificationMedium: 0,
        notificationLow: 0,
      };

      await service.sendDigest('admin@test.com', 'Admin', data);

      const resend = (service as any).resend;
      const call = resend.emails.send.mock.calls[0][0];
      expect(call.html).toContain('ABC-123');
      expect(call.html).toContain('50 L');
      expect(call.html).toContain('2026-07-15');
    });

    it('should show anomaly section only when anomalies exist', async () => {
      const data = {
        companyName: 'Test Company',
        weekRange: '15 juillet — 21 juillet',
        totalDeliveries: 10,
        delivered: 8,
        failed: 1,
        punctuality: 80,
        pendingAnomalies: 0,
        anomalyDetails: [],
        notificationCount: 0,
        notificationCritical: 0,
        notificationHigh: 0,
        notificationMedium: 0,
        notificationLow: 0,
      };

      await service.sendDigest('admin@test.com', 'Admin', data);

      const resend = (service as any).resend;
      const call = resend.emails.send.mock.calls[0][0];
      expect(call.html).not.toContain('Alertes carburant en attente');
    });
  });

  describe('send', () => {
    it('should send email via Resend when configured', async () => {
      const resend = (service as any).resend;
      resend.emails.send.mockResolvedValueOnce({ data: { id: 'email-123' }, error: null });

      await (service as any).send('to@test.com', 'Test Subject', '<p>Test</p>');

      expect(resend.emails.send).toHaveBeenCalledWith({
        from: 'noreply@test.com',
        to: 'to@test.com',
        subject: 'Test Subject',
        html: '<p>Test</p>',
      });
    });

    it('should log email when Resend is not configured', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'RESEND_API_KEY') return undefined;
        return 'default';
      });

      const serviceWithoutResend = new EmailService(mockConfigService as unknown as ConfigService);
      const loggerSpy = jest.spyOn(serviceWithoutResend['logger'], 'log');

      await (serviceWithoutResend as any).send('to@test.com', 'Test Subject', '<p>Test</p>');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('[EMAIL LOG] To: to@test.com'),
      );
    });
  });
});
