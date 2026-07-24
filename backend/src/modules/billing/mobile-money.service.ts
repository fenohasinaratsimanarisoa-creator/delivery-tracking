import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingProvider } from '@prisma/client';

export interface MobilePaymentRequest {
  amount: number;
  currency: string;
  phone: string;
  companyId: string;
  description: string;
}

export interface MobilePaymentResult {
  success: boolean;
  transactionRef?: string;
  providerMessage?: string;
}

@Injectable()
export class MobileMoneyService {
  private readonly logger = new Logger(MobileMoneyService.name);
  private readonly isSandbox: boolean;
  private readonly simulatedLatency: [number, number] = [1000, 4000];

  static validateSandbox(configService: ConfigService): void {
    const isSandbox = configService.get<string>('MOBILE_MONEY_SANDBOX', 'true') === 'true';
    const nodeEnv = configService.get<string>('NODE_ENV', 'development');
    if (isSandbox && nodeEnv === 'production') {
      throw new Error(
        'MOBILE_MONEY_SANDBOX=true is forbidden in production. ' +
          'Set MOBILE_MONEY_SANDBOX=false and configure real API keys (MVOLA_API_KEY, ORANGE_MONEY_API_KEY).',
      );
    }
  }

  constructor(private configService: ConfigService) {
    this.isSandbox = this.configService.get<string>('MOBILE_MONEY_SANDBOX', 'true') === 'true';
  }

  private async simulateLatency(): Promise<void> {
    if (!this.isSandbox) return;
    const [min, max] = this.simulatedLatency;
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private simulateFailure(): boolean {
    if (!this.isSandbox) return false;
    return Math.random() < 0.1;
  }

  async requestPayment(
    req: MobilePaymentRequest,
    provider: BillingProvider,
  ): Promise<MobilePaymentResult> {
    const apiKey = this.configService.get<string>(
      provider === 'mvola' ? 'MVOLA_API_KEY' : 'ORANGE_MONEY_API_KEY',
    );

    if (!apiKey || this.isSandbox) {
      this.logger.warn(`${provider} sandbox mode — simulating payment request`);

      await this.simulateLatency();

      if (this.simulateFailure()) {
        this.logger.warn(
          `${provider} sandbox payment failed (random simulation) — insufficient balance on ${req.phone}`,
        );
        throw new HttpException(
          `Paiement ${provider} échoué : solde insuffisant ou transaction refusée par l'opérateur (${req.phone})`,
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      return {
        success: true,
        transactionRef: `sim_${provider}_${Date.now()}`,
        providerMessage: `Paiement ${provider} simulé — ${req.amount / 100} ${req.currency} débité du ${req.phone}`,
      };
    }

    this.logger.log(`Requesting ${provider} payment of ${req.amount} from ${req.phone}`);

    // Production path — requires MOBILE_MONEY_SANDBOX=false + real API keys
    // OAuth2 flow: POST /token → client_credentials grant → Bearer token
    // Payment request: POST /v2/payments with token in Authorization header
    // MVola docs: https://developer.mvola.mg/
    // Orange Money docs: https://developer.orange.com/
    throw new HttpException(
      `Mode production ${provider} non implémenté dans cette version. Utilisez MOBILE_MONEY_SANDBOX=true pour le test.`,
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async verifyPayment(transactionRef: string, provider: BillingProvider): Promise<boolean> {
    this.logger.log(`Verifying ${provider} transaction: ${transactionRef}`);

    if (transactionRef.startsWith('sim_')) {
      await this.simulateLatency();
      return !this.simulateFailure();
    }

    return true;
  }

  async handleWebhook(
    payload: any,
    provider: BillingProvider,
  ): Promise<{ transactionRef: string; status: string } | null> {
    this.logger.log(`Handling ${provider} webhook`);

    if (provider === 'mvola') {
      return {
        transactionRef: payload.transactionRef || payload.txnId,
        status: payload.status === 'SUCCESS' || payload.status === 'completed' ? 'paid' : 'failed',
      };
    }

    if (provider === 'orange_money') {
      return {
        transactionRef: payload.payToken || payload.txnid,
        status: payload.status === '200' || payload.status === 'SUCCESS' ? 'paid' : 'failed',
      };
    }

    return null;
  }
}
