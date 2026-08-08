import { describe, expect, it } from 'vitest';

import { isUuid } from './uuid';

describe('isUuid', () => {
  it.each([
    ['lower case', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ['upper case', 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA'],
    ['mixed case and digits', '0f8fad5b-d9cb-469f-A165-70867728950e'],
  ])('accepts a uuid in %s', (_label, value) => {
    expect(isUuid(value)).toBe(true);
  });

  // Every one of these reached Postgres as a bound `uuid` parameter and raised
  // `invalid input syntax for type uuid` (22P02) out of a render.
  it.each([
    ['plain text', 'foo'],
    ['a short label', 'c1'],
    ['a numeric id', '42'],
    ['one character short', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa'],
    ['one character long', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaaa'],
    ['no hyphens', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
    ['a non-hex character', 'zaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
    ['surrounding whitespace', ' aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa '],
    ['an empty string', ''],
    ['SQL in a uuid slot', "'; DROP TABLE clubs; --"],
  ])('rejects %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  // Pinned because JavaScript's `$` is stricter here than Perl's or Python's — it
  // matches only the very end of the input, NOT before a trailing newline. Adding the
  // `m` flag, or porting this regex from another language, would quietly let a uuid
  // with a second line after it through.
  it.each([
    ['a trailing newline', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n'],
    ['a newline and more text', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\nDROP'],
    ['a leading newline', '\naaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
  ])('rejects a uuid with %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });

  it.each([['null', null], ['undefined', undefined]] as const)('rejects %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
