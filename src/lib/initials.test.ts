import { describe, expect, it } from 'vitest';

import { initials } from './initials';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('John Doe')).toBe('JD');
  });

  it('takes the single letter of a one-word name', () => {
    expect(initials('Madonna')).toBe('M');
  });

  it('ignores extra internal, leading and trailing whitespace', () => {
    // `split(/\s+/)` on whitespace-adjacent input yields empty-string elements
    // (e.g. a leading space splits to `['', 'John', 'Doe']`); `filter(Boolean)` drops
    // those before `w[0]` ever sees them. Without that filter, `w[0]` on an empty
    // string element is `undefined`, which is exactly what `?? ''` guards against.
    // This case is the only one that actually exercises that guard.
    expect(initials('  John   Doe  ')).toBe('JD');
  });

  it('returns the empty string for the empty string', () => {
    expect(initials('')).toBe('');
  });

  it('only the first two words count when there are more than two', () => {
    expect(initials('John Ronald Reuel Tolkien')).toBe('JR');
  });
});
