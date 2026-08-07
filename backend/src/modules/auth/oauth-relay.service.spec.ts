import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { OAuthRelayService } from './oauth-relay.service';

describe('OAuthRelayService (nonce + code à usage unique, PKCE)', () => {
  let service: OAuthRelayService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new OAuthRelayService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('begin émet un nonce et issueCode produit un code échangeable avec le bon verifier', () => {
    const verifier = 'verifier-secret-32-bytes-random-value';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = service.begin(challenge);
    expect(relayId).toBeTruthy();
    expect(service.isRelayValid(relayId)).toBe(true);

    const code = service.issueCode(relayId, 'user-1');
    expect(code).toBeTruthy();

    const result = service.verifyAndConsumeCode(code!, verifier);
    expect(result).toEqual({ userId: 'user-1' });
  });

  it('rejette un verifier invalide (code volé sans le secret PKCE)', () => {
    const verifier = 'correct-verifier-32-bytes-value';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = service.begin(challenge);
    const code = service.issueCode(relayId, 'user-1')!;

    expect(service.verifyAndConsumeCode(code, 'wrong-verifier')).toBeNull();
  });

  it('rejette la réutilisation d’un code (single-use)', () => {
    const verifier = 'verifier-32-bytes-secret-again';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = service.begin(challenge);
    const code = service.issueCode(relayId, 'user-1')!;

    expect(service.verifyAndConsumeCode(code, verifier)).toEqual({ userId: 'user-1' });
    expect(service.verifyAndConsumeCode(code, verifier)).toBeNull();
  });

  it('rejette un code forgé / inconnu', () => {
    expect(service.verifyAndConsumeCode('forged-code-value-123', 'verifier')).toBeNull();
  });

  it('rejette un code expiré (TTL 60s)', () => {
    const verifier = 'verifier-expiry-test-value-32';
    const challenge = OAuthRelayService.deriveChallenge(verifier);
    const relayId = service.begin(challenge);
    const code = service.issueCode(relayId, 'user-1')!;

    jest.advanceTimersByTime(61 * 1000);
    expect(service.verifyAndConsumeCode(code, verifier)).toBeNull();
  });

  it('rejette un nonce (state) inconnu ou consommé', () => {
    expect(service.isRelayValid('relay-inconnu')).toBe(false);
    const verifier = 'verifier-nonce-single-use';
    const relayId = service.begin(OAuthRelayService.deriveChallenge(verifier));
    const code = service.issueCode(relayId, 'user-1');
    expect(code).toBeTruthy();
    // le nonce est consommé après l'émission du code
    expect(service.isRelayValid(relayId)).toBe(false);
  });
});
