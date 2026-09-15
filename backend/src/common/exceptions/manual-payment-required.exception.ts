import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Levée par SubscriptionGuard quand l'essai/l'abonnement d'une société a
 * expiré sans paiement manuel validé. Code 402 (Payment Required) délibérément
 * distinct du 403 déjà utilisé par usage.guard.ts (quotas, dormant derrière
 * BILLING_ENABLED) : le frontend doit pouvoir distinguer « quota dépassé » de
 * « accès coupé, direction le paywall » sans comparer des messages en texte.
 *
 * Discriminant transporté via `code` (pas `error`, déjà utilisé par le corps
 * par défaut de HttpException — ex. `error: 'Bad Request'` — et donc réservé
 * par AllExceptionsFilter, qui ne propage QUE `message` par défaut). `code`
 * est propagé explicitement par AllExceptionsFilter pour cette exception.
 */
export class ManualPaymentRequiredException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        code: 'SUBSCRIPTION_REQUIRED',
        message:
          "Votre période d'essai est terminée. Veuillez souscrire à un forfait pour continuer.",
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
