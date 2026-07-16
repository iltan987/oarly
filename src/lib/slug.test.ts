import { describe, it, expect } from 'vitest';
import { validateSlug, RESERVED_SLUGS } from './slug';

describe('validateSlug', () => {
  it('accepts a simple lowercase slug', () => {
    expect(validateSlug('bogazici-kurek')).toEqual({ ok: true });
  });
  it('rejects too short / too long', () => {
    expect(validateSlug('ab')).toEqual({ ok: false, reason: 'length' });
    expect(validateSlug('a'.repeat(41))).toEqual({ ok: false, reason: 'length' });
  });
  it('rejects uppercase, spaces, underscores, leading/trailing hyphen', () => {
    expect((validateSlug('Foo') as { ok: false; reason: string }).reason).toBe('format');
    expect((validateSlug('a b') as { ok: false; reason: string }).reason).toBe('format');
    expect((validateSlug('a_b') as { ok: false; reason: string }).reason).toBe('format');
    expect((validateSlug('-ab') as { ok: false; reason: string }).reason).toBe('format');
    expect((validateSlug('ab-') as { ok: false; reason: string }).reason).toBe('format');
  });
  it('rejects reserved subdomains and apex segments', () => {
    expect((validateSlug('admin') as { ok: false; reason: string }).reason).toBe('reserved');
    expect((validateSlug('www') as { ok: false; reason: string }).reason).toBe('reserved');
    expect((validateSlug('sign-in') as { ok: false; reason: string }).reason).toBe('reserved');
    expect(RESERVED_SLUGS.has('api')).toBe(true);
  });
});
