export function formatAriary(amount?: number): string {
  if (amount === undefined || amount === null) return '';
  return amount.toLocaleString('fr-FR').replace(/\s/g, '\u202F') + '\u00A0Ar';
}
