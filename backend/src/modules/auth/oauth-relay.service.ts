import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  Optional,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

interface MemRelayEntry {
  codeChallenge: string;
  expiresAt: number;
}

interface MemCodeEntry {
  userId: string;
  challenge: string;
  expiresAt: number;
  used: boolean;
}

interface StoredRelay {
  codeChallenge: string;
}

interface StoredCode {
  userId: string;
  challenge: string;
}

const RELAY_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 60;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const RELAY_KEY_PREFIX = 'oauth_relay:';
const CODE_KEY_PREFIX = 'oauth_code:';

// Lecture + suppression ATOMIQUES : un GET puis un DEL séparés laisseraient une
// fenêtre où deux requêtes concurrentes pourraient toutes deux lire le code
// avant qu'aucune ne l'efface, cassant la garantie single-use. GETDEL n'est
// disponible qu'à partir de Redis 6.2 ; ce script Lua fonctionne sur toutes
// les versions supportées par ioredis.
const GET_DEL_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v
`;

/**
 * Store éphémère du flux OAuth natif, partagé via Redis quand disponible
 * (obligatoire dès que le backend tourne sur plusieurs instances : un `begin`
 * traité par l'instance A et un `callback` traité par l'instance B ne
 * partageraient aucun état avec une simple Map en mémoire). Repli en mémoire
 * process (dev sans REDIS_URL / tests) : fonctionnellement identique en
 * mono-instance, perdu au redémarrage — sans impact, les entrées ont un TTL
 * de quelques minutes.
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
  private readonly memRelays = new Map<string, MemRelayEntry>();
  private readonly memCodes = new Map<string, MemCodeEntry>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null) {}

  onModuleInit(): void {
    if (!this.redis) {
      this.cleanupTimer = setInterval(() => this.cleanupMemory(), CLEANUP_INTERVAL_MS);
    }
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  async begin(codeChallenge: string): Promise<string> {
    const relayId = randomBytes(32).toString('hex');
    if (this.redis) {
      const payload: StoredRelay = { codeChallenge };
      await this.redis.set(
        RELAY_KEY_PREFIX + relayId,
        JSON.stringify(payload),
        'EX',
        RELAY_TTL_SECONDS,
      );
    } else {
      this.memRelays.set(relayId, {
        codeChallenge,
        expiresAt: Date.now() + RELAY_TTL_SECONDS * 1000,
      });
    }
    return relayId;
  }

  async isRelayValid(relayId: string): Promise<boolean> {
    if (this.redis) {
      const exists = await this.redis.exists(RELAY_KEY_PREFIX + relayId);
      return exists === 1;
    }
    const relay = this.memRelays.get(relayId);
    if (!relay) return false;
    if (Date.now() > relay.expiresAt) {
      this.memRelays.delete(relayId);
      return false;
    }
    return true;
  }

  async issueCode(relayId: string, userId: string): Promise<string | null> {
    let codeChallenge: string;
    if (this.redis) {
      // Un nonce est consommé une seule fois : GETDEL atomique retire la clé
      // relay dès la lecture, un second appel avec le même relayId échoue.
      const raw = (await this.redis.eval(GET_DEL_SCRIPT, 1, RELAY_KEY_PREFIX + relayId)) as
        string | null;
      if (!raw) return null;
      codeChallenge = (JSON.parse(raw) as StoredRelay).codeChallenge;
    } else {
      const relay = this.memRelays.get(relayId);
      if (!relay || Date.now() > relay.expiresAt) return null;
      this.memRelays.delete(relayId);
      codeChallenge = relay.codeChallenge;
    }

    const code = randomBytes(32).toString('base64url');
    if (this.redis) {
      const payload: StoredCode = { userId, challenge: codeChallenge };
      await this.redis.set(CODE_KEY_PREFIX + code, JSON.stringify(payload), 'EX', CODE_TTL_SECONDS);
    } else {
      this.memCodes.set(code, {
        userId,
        challenge: codeChallenge,
        expiresAt: Date.now() + CODE_TTL_SECONDS * 1000,
        used: false,
      });
    }
    return code;
  }

  /**
   * Valide et consomme un code d'échange.
   * Retourne le userId si PKCE + TTL + single-use sont satisfaits, sinon null.
   */
  async verifyAndConsumeCode(code: string, verifier: string): Promise<{ userId: string } | null> {
    let entry: StoredCode;
    if (this.redis) {
      // GETDEL atomique : garantit le single-use même sous requêtes concurrentes
      // (contrairement à un GET suivi d'un DEL séparé — fenêtre de double-spend).
      const raw = (await this.redis.eval(GET_DEL_SCRIPT, 1, CODE_KEY_PREFIX + code)) as
        string | null;
      if (!raw) return null;
      entry = JSON.parse(raw) as StoredCode;
    } else {
      const memEntry = this.memCodes.get(code);
      if (!memEntry) return null;
      this.memCodes.delete(code);
      if (memEntry.used || Date.now() > memEntry.expiresAt) return null;
      entry = { userId: memEntry.userId, challenge: memEntry.challenge };
    }

    const challenge = OAuthRelayService.deriveChallenge(verifier);
    if (!this.safeEqual(challenge, entry.challenge)) {
      return null;
    }
    return { userId: entry.userId };
  }

  static deriveChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private safeEqual(a: string, b: string): boolean {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  }

  private cleanupMemory(): void {
    const now = Date.now();
    for (const [id, relay] of this.memRelays) {
      if (now > relay.expiresAt) this.memRelays.delete(id);
    }
    for (const [code, entry] of this.memCodes) {
      if (now > entry.expiresAt) this.memCodes.delete(code);
    }
  }
}
