import { describe, it, expect } from 'vitest';
import { asLocale } from '@/i18n/request';

describe('asLocale', () => {
  it('accepts supported locales', () => {
    expect(asLocale('tr')).toBe('tr');
    expect(asLocale('en')).toBe('en');
  });
  it('rejects unsupported/tampered values', () => {
    expect(asLocale('xx')).toBeUndefined();
    expect(asLocale('../../etc/passwd')).toBeUndefined();
    expect(asLocale(undefined)).toBeUndefined();
    expect(asLocale(null)).toBeUndefined();
    expect(asLocale('')).toBeUndefined();
  });
});
