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

    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    const mockResponse = (status: number, body: unknown) =>
      ({
        status,
        ok: status >= 200 && status < 300,
        json: jest.fn().mockResolvedValue(body),
        text: jest.fn().mockResolvedValue(JSON.stringify(body)),
      }) as unknown as Response;

    const prodConfig = (
      overrides: Record<string, string | undefined> = {},
    ): Record<string, string | undefined> => ({
      MOBILE_MONEY_SANDBOX: 'false',
      MVOLA_API_KEY: 'consumer-key',
      MVOLA_API_SECRET: 'consumer-secret',
      MVOLA_MERCHANT_PHONE: '+261340000001',
      MVOLA_PARTNER_NAME: 'Delivery Tracking',
      MVOLA_CALLBACK_URL: undefined,
      ...overrides,
    });

    const makeProdService = (overrides: Record<string, string | undefined> = {}) => {
      mockConfigService.get.mockImplementation((key: string) => prodConfig(overrides)[key]);
      return new MobileMoneyService(mockConfigService as unknown as ConfigService);
    };

    const prodRequest = { ...baseRequest, currency: 'MGA' };

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

    it('should NOT simulate in production mode even with a key set', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
        .mockResolvedValueOnce(
          mockResponse(202, {
            status: 'pending',
            serverCorrelationId: 'corr-123',
            notificationMethod: 'callback',
          }),
        );

      const result = await prodService.requestPayment(prodRequest, 'mvola');

      expect(result.transactionRef).toBe('corr-123');
      expect(result.providerMessage).toContain('Paiement MVola initié');
      expect(result.providerMessage).not.toContain('simulé');
    });

    it('should run the full real MVola flow: OAuth2 token then merchantpay 202', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
        .mockResolvedValueOnce(
          mockResponse(202, {
            status: 'pending',
            serverCorrelationId: 'corr-123',
            notificationMethod: 'callback',
          }),
        );

      const result = await prodService.requestPayment(prodRequest, 'mvola');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
      expect((tokenUrl as string).endsWith('/token')).toBe(true);
      expect((tokenInit as RequestInit).headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('consumer-key:consumer-secret').toString('base64')}`,
      });
      expect(String((tokenInit as RequestInit).body)).toContain('grant_type=client_credentials');

      const [payUrl, payInit] = fetchMock.mock.calls[1];
      expect((payUrl as string).endsWith('/mvola/mm/transactions/type/merchantpay/1.0.0/')).toBe(
        true,
      );
      const payHeaders = (payInit as RequestInit).headers as Record<string, string>;
      expect(payHeaders.Authorization).toBe('Bearer tok-1');
      expect(payHeaders['X-Target-Environment']).toBe('prod');
      const payBody = JSON.parse(String((payInit as RequestInit).body));
      expect(payBody.currency).toBe('ARIARY');
      expect(payBody.amount.amount).toBe(99);
      expect(payBody.creditParty[0].value).toBe('261340000001');
      expect(payBody.debitParty[0].value).toBe('261341234567');

      expect(result).toEqual({
        success: true,
        transactionRef: 'corr-123',
        providerMessage: expect.stringContaining('En attente de validation MVola'),
      });
    });

    it('should reuse the cached MVola token for subsequent payments', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock.mockImplementation((url: string) =>
        url.endsWith('/token')
          ? Promise.resolve(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
          : Promise.resolve(
              mockResponse(202, {
                status: 'pending',
                serverCorrelationId: `corr-${fetchMock.mock.calls.length}`,
              }),
            ),
      );

      await prodService.requestPayment(prodRequest, 'mvola');
      await prodService.requestPayment(prodRequest, 'mvola');

      const tokenCalls = fetchMock.mock.calls.filter(([url]) => (url as string).endsWith('/token'));
      expect(tokenCalls).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('should throw 502 BAD_GATEWAY when MVola rejects the token (401)', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock.mockResolvedValueOnce(mockResponse(401, { errorCode: 'invalid_grant' }));

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
      await expect(done).rejects.toThrow("Erreur d'authentification MVola");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw 502 BAD_GATEWAY when API keys are missing in production', async () => {
      const prodService = makeProdService({ MVOLA_API_SECRET: undefined });
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
      await expect(done).rejects.toThrow('configuration API');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should throw 502 BAD_GATEWAY when MVOLA_MERCHANT_PHONE is missing', async () => {
      const prodService = makeProdService({ MVOLA_MERCHANT_PHONE: undefined });
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }),
      );

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
      await expect(done).rejects.toThrow('compte marchand');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('should throw 402 PAYMENT_REQUIRED on insufficient balance', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
        .mockResolvedValueOnce(
          mockResponse(400, {
            errorCode: 'INSUFFICIENT_BALANCE',
            errorDescription: 'Solde insuffisant',
          }),
        );

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.PAYMENT_REQUIRED }),
      );
      await expect(done).rejects.toThrow('solde insuffisant');
    });

    it('should throw 400 BAD_REQUEST on invalid/not_allowed payment', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
        .mockResolvedValueOnce(
          mockResponse(400, { errorCode: 'not_allowed', errorDescription: 'Numéro invalide' }),
        );

      await expect(prodService.requestPayment(prodRequest, 'mvola')).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_REQUEST }),
      );
    });

    it('should throw 502 BAD_GATEWAY on a 2xx response without pending status', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(mockResponse(200, { access_token: 'tok-1', expires_in: 3600 }))
        .mockResolvedValueOnce(mockResponse(200, { status: 'success' }));

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.BAD_GATEWAY }),
      );
      await expect(done).rejects.toThrow("n'a pas abouti");
    });

    it('should throw 503 SERVICE_UNAVAILABLE on network error', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.SERVICE_UNAVAILABLE }),
      );
      await expect(done).rejects.toThrow('injoignable');
    });

    it('should throw 504 GATEWAY_TIMEOUT on MVola timeout', async () => {
      const prodService = makeProdService();
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const aborted = new DOMException('The operation was aborted.', 'AbortError');
      fetchMock.mockRejectedValueOnce(aborted);

      const done = prodService.requestPayment(prodRequest, 'mvola');
      await expect(done).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.GATEWAY_TIMEOUT }),
      );
    });

    it('should still throw NOT_IMPLEMENTED for Orange Money in production', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'MOBILE_MONEY_SANDBOX') return 'false';
        if (key === 'ORANGE_MONEY_API_KEY') return 'orange-key';
        return undefined;
      });
      const prodService = new MobileMoneyService(mockConfigService as unknown as ConfigService);

      await expect(prodService.requestPayment(baseRequest, 'orange_money')).rejects.toThrow(
        HttpException,
      );
      await expect(prodService.requestPayment(baseRequest, 'orange_money')).rejects.toThrow(
        'Mode production orange_money non implémenté',
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

    it('should NOT confirm a non-simulated transaction without real provider verification', async () => {
      const loggerWarn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

      const result = await service.verifyPayment('real_txn_12345', 'mvola');

      // Une ref réelle ne peut pas être considérée payée sans vérification opérateur :
      // seule la confirmation par webhook signé HMAC (handleWebhook) fait foi.
      expect(result).toBe(false);
      expect(loggerWarn).toHaveBeenCalled();
      loggerWarn.mockRestore();
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
