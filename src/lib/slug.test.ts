import { describe, expect, it } from 'vitest';

import { RESERVED_SLUGS, validateSlug } from './slug';

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
  // Reserving an apex route also has to stop a club from claiming it as a slug: a club
  // at `account` would own `account.oarly.sbs`, which is where every apex `/account`
  // link would land if the reservation were ever dropped.
  it('refuses `account` as a club slug', () => {
    expect((validateSlug('account') as { ok: false; reason: string }).reason).toBe('reserved');
  });
});
