import { parseAmount } from './parse-amount';

describe('parseAmount', () => {
  it('should parse simple number', () => {
    expect(parseAmount('50000')).toBe(50000);
  });

  it('should parse number with non-breaking space (U+202F) as thousand separator', () => {
    expect(parseAmount('50\u202F000')).toBe(50000);
  });

  it('should parse number with regular space as thousand separator', () => {
    expect(parseAmount('54 000')).toBe(54000);
  });

  it('should parse number with Ar suffix', () => {
    expect(parseAmount('50 000Ar')).toBe(50000);
    expect(parseAmount('54\u202F000Ar')).toBe(54000);
  });

  it('should parse number with non-breaking space and Ar suffix', () => {
    expect(parseAmount('50\u202F000Ar')).toBe(50000);
  });

  it('should return undefined for empty string', () => {
    expect(parseAmount('')).toBeUndefined();
  });

  it('should return undefined for null', () => {
    expect(parseAmount(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(parseAmount(undefined)).toBeUndefined();
  });

  it('should handle already-parsed number', () => {
    expect(parseAmount(54000)).toBe(54000);
  });

  it('should handle zero', () => {
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('0Ar')).toBe(0);
  });
});
