import { describe, expect, it } from 'vitest';

import { clampPage, MAX_PAGE, normalizePage, pageCount } from './pagination';

describe('normalizePage', () => {
  // Each of these reached `OFFSET (page - 1) * pageSize` and was rejected by Postgres
  // as a bigint, escaping the render as a 500 on a hand-editable URL:
  //   ?page=1.5  -> invalid input syntax for type bigint: "12.5"
  //   ?page=1e20 -> invalid input syntax for type bigint: "2.5e+21"
  it.each([
    ['a fraction floors', '1.5', 1],
    ['a fraction on a later page floors', '3.9', 3],
    ['Infinity', 'Infinity', 1],
    ['-Infinity', '-Infinity', 1],
    ['a huge exponent is capped', '1e20', MAX_PAGE],
    ['a huge literal is capped', '99999999999', MAX_PAGE],
    ['a negative page', '-3', 1],
    ['zero', '0', 1],
    ['text', 'abc', 1],
    ['an empty string', '', 1],
    ['a whole page passes through', '4', 4],
  ])('%s', (_label, input, expected) => {
    expect(normalizePage(input)).toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['NaN', Number.NaN],
    ['a repeated parameter that arrived as an array', ['1', '2']],
  ])('falls back to page 1 for %s', (_label, input) => {
    expect(normalizePage(input)).toBe(1);
  });

  // Whatever comes out must survive `(page - 1) * pageSize` as a safe integer, or the
  // cap has not actually removed the bigint the guard exists to prevent.
  it('produces an offset that is a safe integer even at the cap', () => {
    const offset = (normalizePage('1e300') - 1) * 25;
    expect(Number.isSafeInteger(offset)).toBe(true);
    expect(String(offset)).not.toContain('e');
  });
});

describe('pageCount', () => {
  it.each([
    [0, 25, 1],
    [1, 25, 1],
    [25, 25, 1],
    [26, 25, 2],
    [100, 25, 4],
  ])('%i rows at %i per page is %i page(s)', (total, pageSize, expected) => {
    expect(pageCount(total, pageSize)).toBe(expected);
  });
});

describe('clampPage', () => {
  it('pulls an out-of-range page back to the last one that exists', () => {
    expect(clampPage('999', 100, 25)).toBe(4);
  });

  it('leaves a page inside the range alone', () => {
    expect(clampPage('2', 100, 25)).toBe(2);
  });

  it('is page 1 when there is nothing to page through', () => {
    expect(clampPage('999', 0, 25)).toBe(1);
  });
});
