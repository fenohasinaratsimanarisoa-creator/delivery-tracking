const LOCALE_MAP: Record<string, string> = {
  fr: 'fr-FR',
  en: 'en-US',
};

export function getLocale(lang?: string): string {
  return LOCALE_MAP[lang || 'fr'] || 'fr-FR';
}

export function formatCurrency(
  amount: number,
  currency: 'MGA' | 'EUR' | 'USD' = 'MGA',
  lang?: string,
): string {
  const locale = getLocale(lang);
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  if (currency === 'MGA') {
    return fmt.format(amount).replace(/Ar\s*/, '').trim() + ' Ar';
  }
  return fmt.format(amount);
}

export function formatDate(
  date: string | Date,
  options?: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  const locale = getLocale(lang);
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, options);
}

export function formatDateTime(
  date: string | Date,
  lang?: string,
): string {
  const locale = getLocale(lang);
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatPhone(phone: string, lang?: string): string {
  const locale = getLocale(lang);
  if (locale === 'fr-FR') {
    const digits = phone.replace(/\D/g, '').slice(-9);
    if (digits.length === 9) {
      return '+261 ' + digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d)/, '$1 $2 $3 $4 $5');
    }
    return phone;
  }
  return phone;
}
