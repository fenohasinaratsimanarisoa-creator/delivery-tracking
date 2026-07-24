import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';

@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);
  private readonly issuer: string;

  constructor(private configService: ConfigService) {
    this.issuer = this.configService.get<string>('TOTP_ISSUER', 'DeliveryTracking');
  }

  async generateSecret(
    email: string,
  ): Promise<{ secret: string; otpauthUrl: string; qrCode: string }> {
    const secret = speakeasy.generateSecret({
      name: `${this.issuer}:${email}`,
      issuer: this.issuer,
    });

    let qrCode = '';
    if (secret.otpauth_url) {
      try {
        qrCode = await qrcode.toDataURL(secret.otpauth_url);
      } catch (err) {
        this.logger.warn('Failed to generate QR code', err);
      }
    }

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url || '',
      qrCode,
    };
  }

  async generateQrCode(email: string, secret: string): Promise<string> {
    const otpauthUrl = `otpauth://totp/${this.issuer}:${email}?secret=${secret}&issuer=${this.issuer}`;
    try {
      return await qrcode.toDataURL(otpauthUrl);
    } catch (err) {
      this.logger.warn('Failed to generate QR code', err);
      return '';
    }
  }

  verifyToken(secret: string, token: string): boolean {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
  }
}
