import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

interface RelayEntry {
  relayId: string;
  codeChallenge: string;
  expiresAt: number;
}

interface CodeEntry {
  code: string;
  userId: string;
  challenge: string;
  expiresAt: number;
  used: boolean;
}

const RELAY_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

/**
 * Store éphémère en mémoire du flux OAuth natif (single-instance Render).
 *
 *  - `relayId` : nonce émis par `begin` (avant l'ouverture du Browser.open),
 *    round-trip via le paramètre OAuth `state` de Google. Émetteur : le serveur.
 *  - `code` : code d'échange à usage unique, TTL 60 s, lié à un utilisateur et au
 *    codeChallenge PKCE. Le JWT de session n'est JAMAIS mis dans une URL : il
 *    n'existe que dans le corps de la réponse de `POST /auth/exchange`.
 */
@Injectable()
export class OAuthRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OAuthRelayService.name);
  private readonly relays = new Map<string, RelayEntry>();
  private readonly codes = new Map<string, CodeEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  begin(codeChallenge: string): string {
    const relayId = randomBytes(32).toString('hex');
    this.relays.set(relayId, {
      relayId,
      codeChallenge,
      expiresAt: Date.now() + RELAY_TTL_MS,
    });
    return relayId;
  }

  isRelayValid(relayId: string): boolean {
    const relay = this.relays.get(relayId);
    if (!relay) return false;
    if (Date.now() > relay.expiresAt) {
      this.relays.delete(relayId);
      return false;
    }
    return true;
  }

  issueCode(relayId: string, userId: string): string | null {
    const relay = this.relays.get(relayId);
    if (!relay || Date.now() > relay.expiresAt) return null;
    // Un nonce est consommé une seule fois : après l'émission du code, il est retiré.
    this.relays.delete(relayId);
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      code,
      userId,
      challenge: relay.codeChallenge,
      expiresAt: Date.now() + CODE_TTL_MS,
      used: false,
    });
    return code;
  }

  /**
   * Valide et consomme un code d'échange.
   * Retourne le userId si PKCE + TTL + single-use sont satisfaits, sinon null.
   */
  verifyAndConsumeCode(code: string, verifier: string): { userId: string } | null {
    const entry = this.codes.get(code);
    if (!entry) return null;
    if (entry.used) {
      this.codes.delete(code);
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.codes.delete(code);
      return null;
    }
    const challenge = this.deriveChallenge(verifier);
    if (!this.safeEqual(challenge, entry.challenge)) {
      return null;
    }
    entry.used = true;
    this.codes.delete(code);
    return { userId: entry.userId };
  }

  static deriveChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private deriveChallenge(verifier: string): string {
    return OAuthRelayService.deriveChallenge(verifier);
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, relay] of this.relays) {
      if (now > relay.expiresAt) this.relays.delete(id);
    }
    for (const [code, entry] of this.codes) {
      if (now > entry.expiresAt) this.codes.delete(code);
    }
  }
}
