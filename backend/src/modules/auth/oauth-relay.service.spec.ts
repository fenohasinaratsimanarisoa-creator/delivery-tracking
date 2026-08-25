import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { OAuthRelayService } from './oauth-relay.service';

describe('OAuthRelayService (nonce + code à usage unique, PKCE)', () => {
  let service: OAuthRelayService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new OAuthRelayService(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('begin émet un nonce et issueCode produit un code échangeable avec le bon verifier', async () => {
    const verifier = 'verifier-secret-32-bytes-random-value';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = await service.begin(challenge);
    expect(relayId).toBeTruthy();
    expect(await service.isRelayValid(relayId)).toBe(true);

    const code = await service.issueCode(relayId, 'user-1');
    expect(code).toBeTruthy();

    const result = await service.verifyAndConsumeCode(code!, verifier);
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('rejette un verifier invalide (code volé sans le secret PKCE)', async () => {
    const verifier = 'correct-verifier-32-bytes-value';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = await service.begin(challenge);
    const code = (await service.issueCode(relayId, 'user-1'))!;

    expect(await service.verifyAndConsumeCode(code, 'wrong-verifier')).toBeNull();
  });

  it('rejette la réutilisation d’un code (single-use)', async () => {
    const verifier = 'verifier-32-bytes-secret-again';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = await service.begin(challenge);
    const code = (await service.issueCode(relayId, 'user-1'))!;

    expect(await service.verifyAndConsumeCode(code, verifier)).toEqual({ userId: 'user-1' });
    expect(await service.verifyAndConsumeCode(code, verifier)).toBeNull();
  });

  it('rejette un code forgé / inconnu', async () => {
    expect(await service.verifyAndConsumeCode('forged-code-value-123', 'verifier')).toBeNull();
  });

  it('rejette un code expiré (TTL 60s)', async () => {
    const verifier = 'verifier-expiry-test-value-32';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = await service.begin(challenge);
    const code = (await service.issueCode(relayId, 'user-1'))!;

    jest.advanceTimersByTime(61 * 1000);
    expect(await service.verifyAndConsumeCode(code, verifier)).toBeNull();
  });

  it('rejette un nonce (state) inconnu ou consommé', async () => {
    expect(await service.isRelayValid('relay-inconnu')).toBe(false);
    const verifier = 'verifier-nonce-single-use';
    const relayId = await service.begin(OAuthRelayService.deriveChallenge(verifier));
    const code = await service.issueCode(relayId, 'user-1');
    expect(code).toBeTruthy();
    // le nonce est consommé après l'émission du code
    expect(await service.isRelayValid(relayId)).toBe(false);
  });
});
