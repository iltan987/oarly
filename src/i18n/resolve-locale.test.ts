import { describe, it, expect } from 'vitest';
import { resolveLocale } from '@/i18n/resolve-locale';

describe('resolveLocale', () => {
  it('defaults to Turkish when header is empty', () => {
    expect(resolveLocale('')).toBe('tr');
  });
  it('returns tr when Turkish is preferred', () => {
    expect(resolveLocale('tr,en;q=0.9')).toBe('tr');
  });
  it('returns en for an English-only client', () => {
    expect(resolveLocale('en-US,en;q=0.8')).toBe('en');
  });
  it('falls back to tr for an unsupported language', () => {
    expect(resolveLocale('fr-FR,fr;q=0.9')).toBe('tr');
  });
});
