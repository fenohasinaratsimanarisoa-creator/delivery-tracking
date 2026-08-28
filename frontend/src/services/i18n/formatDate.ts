import i18n from './i18n';

function getLocale(): string {
  const lang = i18n.language || 'fr';
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const defaults: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(getLocale(), options || defaults);
}

export function formatDateTime(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const defaults: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  };
  return d.toLocaleString(getLocale(), options || defaults);
}

export function formatDateShort(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const defaults: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return d.toLocaleDateString(getLocale(), options || defaults);
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(getLocale(), { month: 'long' });
}

export function formatDateLong(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(getLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Temps relatif court pour le TEMPS RÉEL (« il y a 3 min »). Pour l'historique
 * on utilise une date absolue (formatDate / formatDateTime). Bascule sur une
 * date absolue au-delà de `absoluteAfterHours` (défaut 24 h).
 */
export function formatRelativeTime(date: Date | string, absoluteAfterHours = 24): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const ms = d.getTime();
  if (Number.isNaN(ms)) return '—';
  const diffSec = Math.round((Date.now() - ms) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'short' });

  if (Math.abs(diffSec) < 45) return rtf.format(-Math.round(diffSec), 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < absoluteAfterHours) return rtf.format(-diffHour, 'hour');
  return formatDateTime(d);
}
