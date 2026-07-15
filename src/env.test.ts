import { describe, it, expect } from 'vitest';
import { parseEnv } from '@/env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  BETTER_AUTH_SECRET: 'secret-value',
  BETTER_AUTH_URL: 'http://localhost:3000',
  APP_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('parses a valid minimal env and defaults TRUSTED_ORIGINS to APP_URL', () => {
    const env = parseEnv(base);
    expect(env.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(env.TRUSTED_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('splits TRUSTED_ORIGINS on commas', () => {
    const env = parseEnv({ ...base, TRUSTED_ORIGINS: 'https://a.com, https://b.com' });
    expect(env.TRUSTED_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
  });

  it('throws when a required var is missing', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow();
  });
});
