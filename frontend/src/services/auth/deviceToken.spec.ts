import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit 2026-08-27, HAUTE) : ensureNativeDeviceToken()
// écrivait le cache anti-répétition (24h) MÊME quand l'écriture native avait
// réellement échoué (Keystore matériel indisponible/corrompu). Résultat : plus
// aucune tentative de repush pendant 24h alors que le worker natif n'avait
// jamais reçu de credential valide — reproduisant la panne "arrêt d'envoi en
// veille" corrigée le même jour, avec un blocage de 24h au lieu de permanent.
// Le cache ne doit être écrit QUE si setNativeAuthToken() renvoie true.
// =============================================================================

const { mockSetNativeAuthToken, mockApiPost } = vi.hoisted(() => ({
  mockSetNativeAuthToken: vi.fn(),
  mockApiPost: vi.fn(),
}));

vi.mock('../tracking/backgroundLocation', () => ({
  setNativeAuthToken: mockSetNativeAuthToken,
}));

vi.mock('../api/client', () => ({
  default: { post: mockApiPost },
}));

import { ensureNativeDeviceToken, clearDeviceTokenPushCache } from './deviceToken';

const DEVICE_TOKEN = 'device-token-longue-duree';
const EXPIRES_AT = Date.now() + 30 * 24 * 60 * 60 * 1000;

describe('ensureNativeDeviceToken — cache anti-répétition conditionné au succès natif', () => {
  beforeEach(() => {
    mockSetNativeAuthToken.mockReset();
    mockApiPost.mockReset();
    clearDeviceTokenPushCache();
  });

  it('écrit le cache anti-répétition quand setNativeAuthToken réussit (true)', async () => {
    mockApiPost.mockResolvedValue({ data: { deviceToken: DEVICE_TOKEN, expiresAt: EXPIRES_AT } });
    mockSetNativeAuthToken.mockResolvedValue(true);

    await ensureNativeDeviceToken();
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    // Cache écrit → un second appel (sans force) est throttlé, aucun nouvel appel réseau.
    await ensureNativeDeviceToken();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it("N'écrit PAS le cache anti-répétition quand setNativeAuthToken échoue (false) — pour permettre un nouveau retry", async () => {
    mockApiPost.mockResolvedValue({ data: { deviceToken: DEVICE_TOKEN, expiresAt: EXPIRES_AT } });
    mockSetNativeAuthToken.mockResolvedValue(false);

    await ensureNativeDeviceToken();
    expect(mockApiPost).toHaveBeenCalledTimes(1);

    // Cache NON écrit (échec natif) → un second appel (sans force) retente immédiatement.
    await ensureNativeDeviceToken();
    expect(mockApiPost).toHaveBeenCalledTimes(2);
  });
});
