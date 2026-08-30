import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BillingProvider } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// MVola — API commerçant (Merchant Pay) — https://developer.mvola.mg/
//
// Authentification OAuth2 client_credentials :
//   POST {base}/token
//     Authorization: Basic base64(consumerKey:consumerSecret)   (MVOLA_API_KEY / MVOLA_API_SECRET)
//     Content-Type: application/x-www-form-urlencoded
//     body: grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE
//   → { access_token, token_type: "Bearer", expires_in: 3600 }
//
// Initiation de paiement :
//   POST {base}/mvola/mm/transactions/type/merchantpay/1.0.0/
//     Authorization: Bearer <access_token>
//     X-Correlation-ID : UUID unique de la requête
//     PartnerName / UserLanguage / UserAccountIdentifier (compte marchand)
//     X-Target-Environment : 'sandbox' | 'prod'
//     body: { amount: { amount, orderingIndicator: false },
//             debitParty: [{ key: 'msisdn', value: <payeur> }],
//             creditParty: [{ key: 'msisdn', value: <marchand> }],
//             currency: 'ARIARY' }
//   → 202 { status: 'pending', serverCorrelationId, notificationMethod: 'callback' }
//
// Suivi du statut (polling optionnel) :
//   GET {base}/mvola/mm/transactions/type/merchantpay/1.0.0/status/{serverCorrelationId}
//
// Environnements : sandbox https://devapi.mvola.mg · production https://api.mvola.mg
// La CONFIRMATION du paiement reste le webhook signé HMAC (handleWebhook →
// confirmMobileMoney dans billing.service.ts) : la ref que nous stockons est le
// serverCorrelationId, la même que MVola renvoie dans sa notification.
// Orange Money (https://developer.orange.com/) : non implémenté dans cette version.
// ─────────────────────────────────────────────────────────────────────────────
const MVOLA_SANDBOX_BASE_URL = 'https://devapi.mvola.mg';
const MVOLA_PROD_BASE_URL = 'https://api.mvola.mg';
const MVOLA_TOKEN_PATH = '/token';
const MVOLA_PAYMENT_PATH = '/mvola/mm/transactions/type/merchantpay/1.0.0/';
const MVOLA_SCOPE = 'EXT_INT_MVOLA_SCOPE';
const MVOLA_REQUEST_TIMEOUT_MS = 15_000;
// Marge de sécurité avant l'expiration du token MVola : on redemande un token un
// peu AVANT expires_in pour ne jamais lancer un paiement avec un token périmé.
const MVOLA_TOKEN_SAFETY_MARGIN_MS = 60_000;

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

interface MvolaErrorPayload {
  errorCode?: string;
  errorDescription?: string;
  errorMessage?: string;
}

@Injectable()
export class MobileMoneyService {
  private readonly logger = new Logger(MobileMoneyService.name);
  private readonly isSandbox: boolean;
  private readonly simulatedLatency: [number, number] = [1000, 4000];
  private mvolaTokenCache: { token: string; expiresAt: number } | null = null;

  static validateSandbox(configService: ConfigService): void {
    // Même garde que StripeService.validateConfig : si la facturation est
    // désactivée (mode pilote, BILLING_ENABLED != 'true'), Mobile Money n'est
    // jamais sollicité — pas de raison d'exiger une config sandbox=false.
    // Avant : ce garde tournait INCONDITIONNELLEMENT, plantant le boot au
    // démarrage de tout déploiement en NODE_ENV=production qui n'avait pas
    // explicitement défini MOBILE_MONEY_SANDBOX, même sans jamais utiliser
    // la facturation mobile money.
    const billingEnabled = configService.get<string>('BILLING_ENABLED', 'false') === 'true';
    if (!billingEnabled) return;
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

  private mvolaBaseUrl(): string {
    return this.isSandbox ? MVOLA_SANDBOX_BASE_URL : MVOLA_PROD_BASE_URL;
  }

  /** fetch avec timeout — erreurs réseau/temporisation traduites en 503 clair. */
  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MVOLA_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      // DOMException (AbortError) n'est PAS instanceof Error — on teste le name.
      const aborted = (err as { name?: string })?.name === 'AbortError';
      this.logger.error(
        `MVola HTTP error (${aborted ? 'timeout' : 'network'}): ${(err as Error).message}`,
      );
      throw new HttpException(
        "L'opérateur MVola est injoignable. Réessayez dans quelques instants.",
        aborted ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * MVola OAuth2 client_credentials : obtient un Bearer token, mis en cache
   * jusqu'à son expiration (moins la marge de sécurité). Un paiement n'attend
   * donc jamais un aller-retour /token à chaque demande.
   */
  private async getMvolaAccessToken(): Promise<string> {
    if (this.mvolaTokenCache && this.mvolaTokenCache.expiresAt > Date.now()) {
      return this.mvolaTokenCache.token;
    }

    const consumerKey = this.configService.get<string>('MVOLA_API_KEY', '');
    const consumerSecret = this.configService.get<string>('MVOLA_API_SECRET', '');
    if (!consumerKey || !consumerSecret) {
      this.logger.error('MVOLA_API_KEY / MVOLA_API_SECRET not configured for production payment');
      throw new HttpException(
        "Paiement MVola indisponible : la configuration API de l'opérateur est incomplète. Contactez l'administrateur.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const res = await this.fetchWithTimeout(`${this.mvolaBaseUrl()}${MVOLA_TOKEN_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: MVOLA_SCOPE }),
    });

    if (res.status === 401 || res.status === 403) {
      this.logger.error(`MVola /token rejected: HTTP ${res.status}`);
      throw new HttpException(
        "Erreur d'authentification MVola — vérifiez les clés API (MVOLA_API_KEY / MVOLA_API_SECRET).",
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(`MVola /token failed: HTTP ${res.status} ${body}`);
      throw new HttpException(
        "L'opérateur MVola a rejeté la demande de paiement. Réessayez dans quelques instants.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      this.logger.error(`MVola /token response without access_token: ${JSON.stringify(data)}`);
      throw new HttpException(
        "Réponse MVola invalide : jeton d'authentification manquant.",
        HttpStatus.BAD_GATEWAY,
      );
    }
    const expiresInMs = (data.expires_in ?? 3600) * 1000;
    this.mvolaTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs - MVOLA_TOKEN_SAFETY_MARGIN_MS,
    };
    return data.access_token;
  }

  /** Traduit une erreur JSON MVola en HttpException au message clair. */
  private mvolaErrorToHttpException(status: number, err: MvolaErrorPayload): HttpException {
    const code = (err.errorCode ?? '').toLowerCase();
    const detail = err.errorDescription || err.errorMessage || '';
    const suffix = detail ? ` — ${detail}` : '';

    if (code.includes('insufficient') || code.includes('balance')) {
      return new HttpException(
        `Paiement MVola échoué : solde insuffisant ou transaction refusée par l'opérateur${suffix}`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    if (status === 401 || status === 403) {
      return new HttpException(`Erreur d'authentification MVola${suffix}`, HttpStatus.BAD_GATEWAY);
    }
    if (status === 400 || code.includes('invalid') || code.includes('not_allowed')) {
      return new HttpException(
        `Demande de paiement MVola refusée (numéro ou montant invalide)${suffix}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    return new HttpException(
      `L'opérateur MVola a refusé le paiement${suffix}`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  /**
   * MVola Merchant Pay : initie la transaction et renvoie le serverCorrelationId
   * — c'est CETTE référence que la notification MVola (webhook signé HMAC)
   * renverra ensuite pour confirmer le paiement.
   */
  private async requestMvolaPayment(
    token: string,
    req: MobilePaymentRequest,
  ): Promise<{ serverCorrelationId: string }> {
    const merchantPhone = this.configService.get<string>('MVOLA_MERCHANT_PHONE', '');
    if (!merchantPhone) {
      this.logger.error('MVOLA_MERCHANT_PHONE not configured for production payment');
      throw new HttpException(
        "Paiement MVola indisponible : le compte marchand (MVOLA_MERCHANT_PHONE) n'est pas configuré. Contactez l'administrateur.",
        HttpStatus.BAD_GATEWAY,
      );
    }

    const partnerName = this.configService.get<string>('MVOLA_PARTNER_NAME', 'Delivery Tracking');
    const callbackUrl = this.configService.get<string>('MVOLA_CALLBACK_URL', '');
    // req.amount est en unités mineures (centimes) ; MVola attend des Ariary
    // entiers (pas de décimale). Les plans doivent être définis en Ariary pour
    // un paiement MVola réel — on refuse de deviner une conversion devises ici.
    const amountMajor = Math.round(req.amount / 100);
    const payerPhone = req.phone.replace(/^\+/, '');
    const creditPhone = merchantPhone.replace(/^\+/, '');

    const res = await this.fetchWithTimeout(`${this.mvolaBaseUrl()}${MVOLA_PAYMENT_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Correlation-ID': randomUUID(),
        PartnerName: partnerName,
        UserLanguage: 'FR',
        UserAccountIdentifier: JSON.stringify({
          identifierType: 'msisdn',
          identifier: creditPhone,
        }),
        'X-Target-Environment': this.isSandbox ? 'sandbox' : 'prod',
        ...(callbackUrl ? { CallbackURL: callbackUrl } : {}),
      },
      body: JSON.stringify({
        amount: { amount: amountMajor, orderingIndicator: false },
        debitParty: [{ key: 'msisdn', value: payerPhone }],
        creditParty: [{ key: 'msisdn', value: creditPhone }],
        currency: 'ARIARY',
      }),
    });

    const data = (await res.json().catch(() => ({}))) as MvolaErrorPayload & {
      status?: string;
      serverCorrelationId?: string;
      notificationMethod?: string;
    };

    if (!res.ok) {
      throw this.mvolaErrorToHttpException(res.status, data);
    }

    if (res.status === 202 && data.status === 'pending' && data.serverCorrelationId) {
      this.logger.log(`MVola payment initiated: serverCorrelationId=${data.serverCorrelationId}`);
      return { serverCorrelationId: data.serverCorrelationId };
    }

    // Réponse 2xx inattendue (pas la forme "pending" documentée) : on refuse
    // d'affirmer un paiement dont on ne connaît pas la référence — mieux vaut
    // un échec explicite qu'une promesse non tenue.
    this.logger.error(`MVola payment unexpected response: ${JSON.stringify(data)}`);
    throw new HttpException(
      "La demande de paiement MVola n'a pas abouti. Réessayez.",
      HttpStatus.BAD_GATEWAY,
    );
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

    // ── MVola RÉEL (MOBILE_MONEY_SANDBOX=false) ──
    // Flux OAuth2 client_credentials → Bearer token (mis en cache) puis
    // POST /mvola/mm/transactions/type/merchantpay/1.0.0/. La référence stockée
    // (serverCorrelationId) est celle que la notification MVola renverra pour
    // confirmer le paiement via le webhook signé HMAC existant.
    if (provider === 'mvola') {
      const token = await this.getMvolaAccessToken();
      const { serverCorrelationId } = await this.requestMvolaPayment(token, req);
      return {
        success: true,
        transactionRef: serverCorrelationId,
        providerMessage: `Paiement MVola initié — ${req.amount / 100} ${req.currency} demandés sur le ${req.phone}. En attente de validation MVola.`,
      };
    }

    // ── Orange Money réel : non implémenté dans cette version (OAuth2 Orange
    // Developer + API différente) — https://developer.orange.com/
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

    // SÉCURITÉ : une transaction RÉELLE (hors sandbox) ne peut PAS être considérée
    // payée sans vérification auprès de l'opérateur (MVola/Orange Money). Avant, la
    // méthode retournait `true` inconditionnellement pour toute ref non-"sim_", ce qui
    // permettait de considérer comme payé n'importe quel identifiant inventé. La
    // confirmation d'un paiement réel passe UNIQUEMENT par le webhook signé HMAC
    // (handleWebhook → confirmMobileMoney) : tant que la vérification d'état par API
    // opérateur n'est pas intégrée (feature flag PAYMENT_VERIFY_REAL), on refuse ici
    // d'affirmer le paiement — logger.warn explicite pour l'audit terrain.
    this.logger.warn(
      `verifyPayment: no real provider verification for ${provider} transaction ${transactionRef} — refusing to confirm payment (use the signed webhook flow)`,
    );
    return false;
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
