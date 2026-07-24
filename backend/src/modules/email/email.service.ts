import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { t, type Language } from '../../common/i18n';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: Resend | null = null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.logger.warn('RESEND_API_KEY not set — emails will be logged only');
    }
    this.from = this.configService.get<string>('EMAIL_FROM', 'noreply@deliverytrack.app');
    this.appUrl = this.configService.get<string>('APP_URL', 'http://localhost:5173');
  }

  async sendPasswordReset(email: string, token: string, lang: Language = 'fr'): Promise<void> {
    const link = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111827">${t('email.passwordReset.heading', lang)}</h2>
        <p style="color:#6b7280;line-height:1.5">
          ${t('email.passwordReset.body', lang)}
        </p>
        <a href="${link}"
           style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">
          ${t('email.passwordReset.button', lang)}
        </a>
        <p style="color:#9ca3af;font-size:13px">
          ${t('email.passwordReset.footer', lang)}
        </p>
      </div>
    `;

    await this.send(email, t('email.passwordReset.subject', lang), html);
  }

  async sendInvitation(email: string, inviteUrl: string, role: string, lang: Language = 'fr'): Promise<void> {
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111827">${t('email.invitation.heading', lang)}</h2>
        <p style="color:#6b7280;line-height:1.5">
          ${t('email.invitation.body', lang, { role })}
        </p>
        <a href="${inviteUrl}"
           style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">
          ${t('email.invitation.button', lang)}
        </a>
        <p style="color:#9ca3af;font-size:13px">
          ${t('email.invitation.footer', lang)}
        </p>
      </div>
    `;
    await this.send(email, t('email.invitation.subject', lang), html);
  }

  async sendDigest(
    email: string,
    firstName: string,
    data: {
      companyName: string;
      weekRange: string;
      totalDeliveries: number;
      delivered: number;
      failed: number;
      punctuality: number;
      pendingAnomalies: number;
      anomalyDetails: Array<{ vehicle: string; liters: number; date: string }>;
    },
    lang: Language = 'fr',
  ): Promise<void> {
    const anomalyRows = data.anomalyDetails
      .map(
        (a) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${a.vehicle}</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${a.liters} L</td><td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px">${a.date}</td></tr>`,
      )
      .join('');

    const html = `
      <div style="font-family:Inter,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
        <div style="border-bottom:2px solid #F2A93C;padding-bottom:16px;margin-bottom:24px">
          <h1 style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;color:#E8ECF3;margin:0">${t('email.digest.brand', lang)}</h1>
          <p style="color:#9BA6B9;font-size:13px;margin:4px 0 0">${t('email.digest.subtitle', lang, { weekRange: data.weekRange })}</p>
        </div>
        <p style="color:#E8ECF3;font-size:14px;line-height:1.5">${t('email.digest.greeting', lang, { firstName })}</p>
        <p style="color:#9BA6B9;font-size:13px;line-height:1.5">${t('email.digest.intro', lang, { companyName: data.companyName })}</p>

        <table style="width:100%;border-collapse:collapse;margin:20px 0">
          <tr>
            <td style="background:#121B2E;padding:16px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#F2A93C">${data.totalDeliveries}</div>
              <div style="font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em">${t('email.digest.metricDeliveries', lang)}</div>
            </td>
            <td style="width:8px"></td>
            <td style="background:#121B2E;padding:16px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#3FA796">${data.punctuality}%</div>
              <div style="font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em">${t('email.digest.metricPunctuality', lang)}</div>
            </td>
            <td style="width:8px"></td>
            <td style="background:#121B2E;padding:16px;border-radius:8px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:${data.pendingAnomalies > 0 ? '#E8544C' : '#3FA796'}">${data.pendingAnomalies}</div>
              <div style="font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em">${t('email.digest.metricAlerts', lang)}</div>
            </td>
          </tr>
        </table>

        ${
          data.anomalyDetails.length > 0
            ? `
        <h3 style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;color:#E8ECF3;margin:20px 0 8px">${t('email.digest.anomalySection', lang)}</h3>
        <table style="width:100%;border-collapse:collapse;background:#121B2E;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#0B1220">
              <th style="padding:8px 12px;font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em;text-align:left">${t('email.digest.anomalyVehicle', lang)}</th>
              <th style="padding:8px 12px;font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em;text-align:left">${t('email.digest.anomalyVolume', lang)}</th>
              <th style="padding:8px 12px;font-size:11px;color:#9BA6B9;text-transform:uppercase;letter-spacing:0.04em;text-align:left">${t('email.digest.anomalyDate', lang)}</th>
            </tr>
          </thead>
          <tbody>${anomalyRows}</tbody>
        </table>
        `
            : ''
        }

        <div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(242,169,60,0.2)">
          <a href="${this.appUrl}/dashboard" style="display:inline-block;padding:10px 20px;background:#F2A93C;color:#0B1220;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px">
            ${t('email.digest.ctaButton', lang)}
          </a>
        </div>
        <p style="color:#5D6B83;font-size:11px;margin-top:20px">
          ${t('email.digest.footer', lang)}
        </p>
      </div>
    `;

    await this.send(email, t('email.digest.subject', lang, { weekRange: data.weekRange }), html);
  }

  async sendWelcome(email: string, firstName: string, lang: Language = 'fr'): Promise<void> {
    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#111827">${t('email.welcome.heading', lang)}</h2>
        <p style="color:#6b7280;line-height:1.5">
          ${t('email.welcome.body', lang, { firstName })}
        </p>
        <a href="${this.appUrl}/login"
           style="display:inline-block;padding:12px 24px;background:#1a56db;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">
          ${t('email.welcome.button', lang)}
        </a>
      </div>
    `;

    await this.send(email, t('email.welcome.subject', lang), html);
  }

  async sendBillingActivated(
    email: string,
    firstName: string,
    planName: string,
    lang: Language = 'fr',
  ): Promise<void> {
    await this.send(
      email,
      t('email.billing.activatedSubject', lang),
      t('email.billing.activatedBody', lang, {
        firstName,
        planName,
        url: `${this.appUrl}/billing`,
      }),
    );
  }

  async sendBillingPaymentFailed(
    email: string,
    firstName: string,
    lang: Language = 'fr',
  ): Promise<void> {
    await this.send(
      email,
      t('email.billing.paymentFailedSubject', lang),
      t('email.billing.paymentFailedBody', lang, {
        firstName,
        url: `${this.appUrl}/billing`,
      }),
    );
  }

  async sendBillingCanceled(
    email: string,
    firstName: string,
    lang: Language = 'fr',
  ): Promise<void> {
    await this.send(
      email,
      t('email.billing.canceledSubject', lang),
      t('email.billing.canceledBody', lang, {
        firstName,
        url: `${this.appUrl}/billing`,
      }),
    );
  }

  async sendBillingExpired(
    email: string,
    firstName: string,
    date: string,
    lang: Language = 'fr',
  ): Promise<void> {
    await this.send(
      email,
      t('email.billing.expiredSubject', lang),
      t('email.billing.expiredBody', lang, {
        firstName,
        date,
        url: `${this.appUrl}/billing`,
      }),
    );
  }

  async sendBillingSuspended(
    email: string,
    firstName: string,
    lang: Language = 'fr',
  ): Promise<void> {
    await this.send(
      email,
      t('email.billing.suspendedSubject', lang),
      t('email.billing.suspendedBody', lang, {
        firstName,
        url: `${this.appUrl}/billing`,
      }),
    );
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (this.resend) {
      try {
        await this.resend.emails.send({ from: this.from, to, subject, html });
        this.logger.log(`Email sent to ${to}: ${subject}`);
      } catch (err) {
        this.logger.error(`Failed to send email to ${to}`, err);
      }
    } else {
      this.logger.log(`[EMAIL LOG] To: ${to} | Subject: ${subject}`);
    }
  }
}
