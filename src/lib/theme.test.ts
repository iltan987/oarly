import { describe, it, expect } from 'vitest';
import { accentStyle } from '@/lib/theme';

describe('accentStyle', () => {
  it('sets the --club-accent custom property when an accent is given', () => {
    expect(accentStyle('oklch(0.55 0.2 30)')).toEqual({ '--club-accent': 'oklch(0.55 0.2 30)' });
  });
  it('returns an empty style when no accent is given', () => {
    expect(accentStyle(null)).toEqual({});
    expect(accentStyle(undefined)).toEqual({});
  });
});
