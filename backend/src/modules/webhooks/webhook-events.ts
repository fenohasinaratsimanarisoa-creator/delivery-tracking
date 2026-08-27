/**
 * Liste EXHAUSTIVE des événements webhook qu'un client peut souscrire.
 * Doit rester synchronisée avec les appels `webhooks.dispatch('<event>', …)`
 * de deliveries.service.ts — c'est la seule source de vérité.
 *
 * AVANT : `CreateWebhookDto.events` acceptait n'importe quelle chaîne. Un client
 * qui s'abonnait à `delivery_delivered` (underscore, comme l'ancien enum Prisma
 * `WebhookEvent` et certains exemples de doc) ne recevait JAMAIS rien, sans
 * aucune erreur — le code n'émet que la forme pointée.
 */
export const WEBHOOK_EVENTS = [
  'delivery.status_changed',
  'delivery.delivered',
  'delivery.driver_assigned',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];
