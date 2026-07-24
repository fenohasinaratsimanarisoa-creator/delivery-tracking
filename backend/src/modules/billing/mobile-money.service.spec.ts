import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingProvider } from '@prisma/client';
import { MobileMoneyService } from './mobile-money.service';

const mockConfigService = {
  get: jest.fn(),
};

describe('MobileMoneyService', () => {
  let service: MobileMoneyService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'MOBILE_MONEY_SANDBOX') return 'true';
      if (key === 'MVOLA_API_KEY') return undefined;
      if (key === 'ORANGE_MONEY_API_KEY') return undefined;
      return undefined;
    });

    service = new MobileMoneyService(mockConfigService as unknown as ConfigService);
  });

  describe('requestPayment', () => {
    const baseRequest = {
      amount: 9900,
      currency: 'EUR',
      phone: '+261341234567',
      companyId: 'comp-1',
      description: 'Test payment',
    };

    it('should simulate successful payment in sandbox mode', async () => {
      jest.spyOn(service as any, 'simulateLatency').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'simulateFailure').mockReturnValue(false);

      const result = await service.requestPayment(baseRequest, 'mvola');

      expect(result.success).toBe(true);
      expect(result.transactionRef).toMatch(/^sim_mvola_\d+$/);
      expect(result.providerMessage).toContain('simulé');
    });

    it('should simulate successful payment for Orange Money in sandbox mode', async () => {
      jest.spyOn(service as any, 'simulateLatency').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'simulateFailure').mockReturnValue(false);

      const result = await service.requestPayment(baseRequest, 'orange_money');

      expect(result.success).toBe(true);
      expect(result.transactionRef).toMatch(/^sim_orange_money_\d+$/);
    });

    it('should throw HttpException on simulated failure', async () => {
      jest.spyOn(service as any, 'simulateLatency').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'simulateFailure').mockReturnValue(true);

      await expect(service.requestPayment(baseRequest, 'mvola')).rejects.toThrow(HttpException);
    });

    it('should throw NOT_IMPLEMENTED in production mode', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'MOBILE_MONEY_SANDBOX') return 'false';
        if (key === 'MVOLA_API_KEY') return 'real-api-key';
        return undefined;
      });

      const prodService = new MobileMoneyService(mockConfigService as unknown as ConfigService);

      await expect(prodService.requestPayment(baseRequest, 'mvola')).rejects.toThrow(HttpException);
      await expect(prodService.requestPayment(baseRequest, 'mvola')).rejects.toThrow(
        'Mode production mvola non implémenté',
      );
    });
  });

  describe('verifyPayment', () => {
    it('should return true for simulated transactions', async () => {
      jest.spyOn(service as any, 'simulateLatency').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'simulateFailure').mockReturnValue(false);

      const result = await service.verifyPayment('sim_mvola_12345', 'mvola');

      expect(result).toBe(true);
    });

    it('should return true for non-simulated transactions', async () => {
      const result = await service.verifyPayment('real_txn_12345', 'mvola');

      expect(result).toBe(true);
    });

    it('should randomly fail for simulated transactions', async () => {
      jest.spyOn(service as any, 'simulateLatency').mockResolvedValue(undefined);
      jest.spyOn(service as any, 'simulateFailure').mockReturnValue(true);

      const result = await service.verifyPayment('sim_mvola_12345', 'mvola');

      expect(result).toBe(false);
    });
  });

  describe('handleWebhook', () => {
    it('should parse MVola webhook successfully', async () => {
      const payload = { transactionRef: 'txn_123', status: 'SUCCESS' };
      const result = await service.handleWebhook(payload, 'mvola');

      expect(result).toEqual({
        transactionRef: 'txn_123',
        status: 'paid',
      });
    });

    it('should parse MVola webhook as failed', async () => {
      const payload = { transactionRef: 'txn_123', status: 'FAILED' };
      const result = await service.handleWebhook(payload, 'mvola');

      expect(result).toEqual({
        transactionRef: 'txn_123',
        status: 'failed',
      });
    });

    it('should parse Orange Money webhook successfully', async () => {
      const payload = { payToken: 'token_123', status: '200' };
      const result = await service.handleWebhook(payload, 'orange_money');

      expect(result).toEqual({
        transactionRef: 'token_123',
        status: 'paid',
      });
    });

    it('should parse Orange Money webhook as failed', async () => {
      const payload = { payToken: 'token_123', status: '400' };
      const result = await service.handleWebhook(payload, 'orange_money');

      expect(result).toEqual({
        transactionRef: 'token_123',
        status: 'failed',
      });
    });

    it('should return null for unknown provider', async () => {
      const result = await service.handleWebhook({}, 'stripe' as BillingProvider);

      expect(result).toBeNull();
    });
  });
});
