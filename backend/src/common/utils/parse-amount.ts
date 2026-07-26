export function parseAmount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const str = String(value)
    .replace(/\u202F/g, '')
    .replace(/\s/g, '')
    .replace(/Ar$/i, '')
    .replace(/[^0-9]/g, '');
  if (str.length === 0) return undefined;
  const n = parseInt(str, 10);
  return isNaN(n) ? undefined : n;
}
