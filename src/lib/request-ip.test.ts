import { describe, expect, it } from 'vitest';

import { parseClientIp } from '@/lib/request-ip';

describe('parseClientIp', () => {
  it('takes the leftmost entry of an x-forwarded-for chain', () => {
    expect(parseClientIp({ xForwardedFor: '203.0.113.7, 70.41.3.18, 150.172.238.178', xRealIp: null }))
      .toBe('203.0.113.7');
  });

  it('handles a single-entry x-forwarded-for', () => {
    expect(parseClientIp({ xForwardedFor: '203.0.113.7', xRealIp: null })).toBe('203.0.113.7');
  });

  it('trims surrounding whitespace', () => {
    expect(parseClientIp({ xForwardedFor: '  203.0.113.7 , 70.41.3.18', xRealIp: null })).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(parseClientIp({ xForwardedFor: null, xRealIp: '198.51.100.4' })).toBe('198.51.100.4');
  });

  it('falls back to x-real-ip when x-forwarded-for is present but empty', () => {
    expect(parseClientIp({ xForwardedFor: '   ', xRealIp: '198.51.100.4' })).toBe('198.51.100.4');
  });

  it('returns "unknown" when neither header is present', () => {
    expect(parseClientIp({ xForwardedFor: null, xRealIp: null })).toBe('unknown');
  });
});
