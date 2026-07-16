import { describe, it, expect } from 'vitest';
import { deriveTrustedOrigins } from '@/env';

describe('deriveTrustedOrigins', () => {
  it('defaults to [appUrl] when unset', () => {
    expect(deriveTrustedOrigins(undefined, 'https://app.example')).toEqual(['https://app.example']);
  });

  it('splits + trims a comma list', () => {
    expect(deriveTrustedOrigins('https://a.com, https://b.com', 'https://app.example')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('ignores empty entries', () => {
    expect(deriveTrustedOrigins('https://a.com,,  ', 'https://x')).toEqual(['https://a.com']);
  });
});
