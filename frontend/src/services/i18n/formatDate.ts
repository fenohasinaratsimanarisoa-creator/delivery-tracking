import i18n from './i18n';

function getLocale(): string {
  const lang = i18n.language || 'fr';
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}

/** Placeholder affiché pour une date absente ou invalide. */
export const EMPTY_DATE = '—';

/**
 * Normalise une entrée en Date VALIDE, ou null.
 *
 * Beaucoup de champs de date sont nullables côté API (`scheduledDate`,
 * `completedAt`, `paidAt`…) et une réponse partielle est toujours possible.
 * Avant, `formatDate(undefined)` levait « Cannot read properties of undefined
 * (reading 'toLocaleDateString') » et l'ErrorBoundary remplaçait TOUT l'écran
 * par une page d'erreur — une cellule de tableau sans date faisait tomber la
 * page entière (reproduit sur /deliveries).
 */
function toValidDate(date: Date | string | number | null | undefined): Date | null {
  if (date === null || date === undefined || date === '') return null;
  const d = date instanceof Date ? date : new Date(date);
  return Number.isNaN(d.getTime()) ? null : d;
}

type DateInput = Date | string | number | null | undefined;

export function formatDate(date: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  const defaults: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString(getLocale(), options || defaults);
}

export function formatDateTime(date: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  const defaults: Intl.DateTimeFormatOptions = {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  };
  return d.toLocaleString(getLocale(), options || defaults);
}

export function formatDateShort(date: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  const defaults: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return d.toLocaleDateString(getLocale(), options || defaults);
}

export function formatTime(date: DateInput): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  return d.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatMonth(date: DateInput): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  return d.toLocaleString(getLocale(), { month: 'long' });
}

export function formatDateLong(date: DateInput): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  return d.toLocaleDateString(getLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Temps relatif court pour le TEMPS RÉEL (« il y a 3 min »). Pour l'historique
 * on utilise une date absolue (formatDate / formatDateTime). Bascule sur une
 * date absolue au-delà de `absoluteAfterHours` (défaut 24 h).
 */
export function formatRelativeTime(date: DateInput, absoluteAfterHours = 24): string {
  const d = toValidDate(date);
  if (!d) return EMPTY_DATE;
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto', style: 'short' });

  if (Math.abs(diffSec) < 45) return rtf.format(-Math.round(diffSec), 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute');
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < absoluteAfterHours) return rtf.format(-diffHour, 'hour');
  return formatDateTime(d);
}
