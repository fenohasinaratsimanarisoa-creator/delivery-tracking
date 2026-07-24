import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

@Injectable()
export class EncryptionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EncryptionService.name);
  private key: Buffer | null = null;

  onApplicationBootstrap() {
    const secret = process.env.ENCRYPTION_KEY;
    if (!secret) {
      this.logger.warn(
        'ENCRYPTION_KEY not set — at-rest encryption disabled. Set a 64-char hex key for production.',
      );
      return;
    }
    this.key = scryptSync(secret, 'delivery-tracking-salt', KEY_LENGTH);
    this.logger.log('At-rest encryption key initialized');
  }

  encrypt(plaintext: string): string | null {
    if (!this.key) return null;
    try {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, this.key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    } catch (err) {
      this.logger.error(`Encryption failed: ${(err as Error).message}`);
      return null;
    }
  }

  decrypt(ciphertext: string): string | null {
    if (!this.key) return null;
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) return null;
      const iv = Buffer.from(parts[0], 'hex');
      const tag = Buffer.from(parts[1], 'hex');
      const encrypted = Buffer.from(parts[2], 'hex');
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return decipher.update(encrypted) + decipher.final('utf8');
    } catch (err) {
      this.logger.error(`Decryption failed: ${(err as Error).message}`);
      return null;
    }
  }

  isEnabled(): boolean {
    return this.key !== null;
  }
}
