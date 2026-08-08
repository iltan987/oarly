import { describe, expect, it } from 'vitest';

import { escapeLike, one } from './search-params';

describe('one', () => {
  it('passes a single value through', () => {
    expect(one('a')).toBe('a');
    expect(one(undefined)).toBeUndefined();
  });

  // `?q=a&q=b` arrives as an array. First occurrence wins, matching
  // `URLSearchParams.get`, which is what builds these links on the way back out.
  it('takes the first occurrence of a repeated parameter', () => {
    expect(one(['a', 'b'])).toBe('a');
  });

  it('returns undefined for a parameter that repeated into nothing', () => {
    expect(one([])).toBeUndefined();
  });
});

describe('escapeLike', () => {
  // The decoy. A test covering only `%` passes against a half-written escape, and `_`
  // is the character that actually appears in slugs, email local parts and audit
  // actions — unescaped it matches ANY character and widens the result set silently.
  it('escapes the underscore wildcard', () => {
    expect(escapeLike('skill_level.')).toBe('skill\\_level.');
  });

  it('escapes the percent wildcard', () => {
    expect(escapeLike('100%')).toBe('100\\%');
  });

  // The escape character itself must be escaped, or a term ending in `\` turns the
  // following `%` the caller appends into a literal and the search matches nothing.
  it('escapes the escape character', () => {
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });

  it('escapes each metacharacter exactly once, in one pass', () => {
    // Not `a\\\\\\%b`: a second pass over the output would re-escape the backslashes
    // this one just introduced.
    expect(escapeLike('a\\%_b')).toBe('a\\\\\\%\\_b');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('Boğaziçi Kürek')).toBe('Boğaziçi Kürek');
    expect(escapeLike('')).toBe('');
  });
});
