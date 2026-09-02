/**
 * Scopes reconnus pour les clés API (accès machine en lecture seule).
 *
 * Source de vérité unique : le DTO de création valide contre cette liste et le
 * guard (`ApiKeyOrJwtGuard` / `ApiKeyGuard`) compare `@ApiKeyScope(...)` aux
 * scopes portés par la clé. Un scope hors de cette liste n'a aucun effet — le
 * refuser à la création évite les clés « fantômes » qui semblent avoir des
 * droits qu'aucun endpoint ne consulte.
 */
export const API_KEY_SCOPES = ['deliveries:read', 'tracking:read', 'tracking:sms-relay'] as const;

export type ApiKeyScopeName = (typeof API_KEY_SCOPES)[number];
