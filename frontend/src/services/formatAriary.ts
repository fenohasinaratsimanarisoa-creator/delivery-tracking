export function formatAriary(amount?: number, locale?: string): string {
  if (amount === undefined || amount === null) return '';
  const l = locale ?? (typeof navigator !== 'undefined' ? navigator.language : 'fr-FR');
  return amount.toLocaleString(l).replace(/\s/g, '\u202F') + '\u00A0Ar';
}
