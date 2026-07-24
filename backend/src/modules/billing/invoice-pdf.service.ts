import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InvoiceStatus } from '@prisma/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { t, formatLongDate, type Language } from '../../common/i18n';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);

  constructor(private prisma: PrismaService) {}

  async generateInvoice(invoiceId: string, lang: Language = 'fr'): Promise<Buffer> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        company: true,
        subscription: { include: { plan: true } },
      },
    });

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.pdfData) {
      this.logger.log(`Invoice ${invoice.invoiceNumber} already has PDF — returning existing`);
      return invoice.pdfData;
    }

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const page = doc.addPage([595, 842]);
    const { width, height } = page.getSize();

    const margin = 50;
    let y = height - margin;

    const drawText = (
      text: string,
      x: number,
      yPos: number,
      opts?: { size?: number; bold?: boolean; color?: number[] },
    ) => {
      const f = opts?.bold ? fontBold : font;
      page.drawText(text, {
        x,
        y: yPos,
        size: opts?.size || 10,
        font: f,
        color: rgb(opts?.color?.[0] ?? 0.07, opts?.color?.[1] ?? 0.09, opts?.color?.[2] ?? 0.13),
      });
    };

    drawText('DELIVERYTRACK', margin, y, { size: 20, bold: true });
    drawText(t('pdf.invoice.title', lang), width - margin - 80, y, { size: 18, bold: true });
    y -= 30;

    drawText(invoice.company.name, margin, y, { size: 11 });
    y -= 16;
    if (invoice.company.email) drawText(invoice.company.email, margin, y, { size: 9 });
    y -= 24;

    drawText(t('pdf.invoice.invoiceNumber', lang, { number: invoice.invoiceNumber }), width - margin - 150, y + 10, {
      size: 10,
      bold: true,
    });
    y -= 20;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 20;

    const createdAt = formatLongDate(invoice.createdAt, lang);
    const periodStart = new Date(invoice.subscription.currentPeriodStart).toLocaleDateString(
      lang === 'en' ? 'en-US' : 'fr-FR',
    );
    const periodEnd = new Date(invoice.subscription.currentPeriodEnd).toLocaleDateString(
      lang === 'en' ? 'en-US' : 'fr-FR',
    );

    drawText(t('pdf.invoice.issueDate', lang, { date: createdAt }), margin, y, { size: 9 });
    y -= 14;
    drawText(t('pdf.invoice.period', lang, { start: periodStart, end: periodEnd }), margin, y, { size: 9 });
    y -= 14;
    drawText(t('pdf.invoice.subscription', lang, { name: invoice.subscription.plan.name }), margin, y, { size: 9 });
    y -= 14;
    drawText(t('pdf.invoice.status', lang, {
      status: invoice.status === 'paid'
        ? t('pdf.invoice.paid', lang)
        : t('pdf.invoice.pending', lang),
    }), margin, y, {
      size: 9,
    });
    y -= 30;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 16;

    drawText(t('pdf.invoice.description', lang), margin, y, { size: 9, bold: true });
    drawText(t('pdf.invoice.amount', lang), width - margin - 90, y, { size: 9, bold: true });
    y -= 14;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.3,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= 14;

    const ht = (invoice.amount / 100).toFixed(2);
    const tvaRate = 0.2;
    const tvaAmount = ((invoice.amount * tvaRate) / 100).toFixed(2);
    const ttc = ((invoice.amount * (1 + tvaRate)) / 100).toFixed(2);

    const intervalLabel = invoice.subscription.plan.interval === 'year'
      ? t('invoice.planYearly', lang)
      : t('invoice.planMonthly', lang);
    drawText(
      `${invoice.subscription.plan.name} — ${intervalLabel}`,
      margin,
      y,
      { size: 9 },
    );
    drawText(`${ht} ${invoice.currency}`, width - margin - 90, y, { size: 9 });
    y -= 18;

    drawText(t('pdf.invoice.totalVat', lang), margin, y, { size: 9 });
    drawText(`${tvaAmount} ${invoice.currency}`, width - margin - 90, y, { size: 9 });
    y -= 18;

    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
    y -= 16;

    drawText(t('pdf.invoice.totalTtc', lang), margin, y, { size: 11, bold: true });
    drawText(`${ttc} ${invoice.currency}`, width - margin - 90, y, { size: 11, bold: true });
    y -= 60;

    drawText(t('pdf.invoice.paymentMethod', lang), margin, y, { size: 9, bold: true });
    y -= 14;
    const providerLabels: Record<string, string> = {
      stripe: t('pdf.invoice.providerStripe', lang),
      mvola: t('pdf.invoice.providerMvola', lang),
      orange_money: t('pdf.invoice.providerOrangeMoney', lang),
    };
    drawText(providerLabels[invoice.provider] || invoice.provider, margin, y, { size: 9 });
    y -= 30;

    drawText(t('pdf.invoice.legalNotice', lang), margin, y, { size: 9, bold: true });
    y -= 14;
    drawText(t('pdf.invoice.legalInfo', lang), margin, y, {
      size: 8,
      color: [0.6, 0.6, 0.6],
    });
    y -= 12;
    drawText(
      t('pdf.invoice.legalAddress', lang),
      margin,
      y,
      { size: 8, color: [0.6, 0.6, 0.6] },
    );
    y -= 12;

    y = margin + 40;
    drawText(t('pdf.invoice.footer', lang), margin, y, { size: 8, color: [0.6, 0.6, 0.6] });
    y -= 12;
    drawText(t('pdf.invoice.thanks', lang), margin, y, { size: 8, color: [0.6, 0.6, 0.6] });

    const pdfBytes = await doc.save();
    const buffer = Buffer.from(pdfBytes);

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdfData: buffer },
    });

    return buffer;
  }
}
