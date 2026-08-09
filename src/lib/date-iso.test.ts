import { describe, expect, it } from 'vitest';

import { isDateISO } from './date-iso';
import { addDaysISO } from './date-tz';

describe('isDateISO', () => {
  it.each(['2026-01-01', '2026-12-31', '2026-08-08', '2024-02-29', '2000-02-29', '0096-02-29'])(
    'accepts %s', (v) => expect(isDateISO(v)).toBe(true),
  );

  // The whole point: each of these passes /^\d{4}-\d{2}-\d{2}$/ and is not a date.
  it.each([
    ['a day past the end of February', '2026-02-31'],
    ['a day past the end of a 30-day month', '2026-04-31'],
    ['29 February in a common year', '2026-02-29'],
    ['29 February in a century that is not a leap year', '1900-02-29'],
    ['month 13', '2026-13-45'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['day 32', '2026-01-32'],
  ])('rejects %s', (_label, v) => expect(isDateISO(v)).toBe(false));

  it.each([
    ['the wrong shape', '2026-1-1'],
    ['an ISO datetime', '2026-01-01T00:00:00Z'],
    ['trailing text', '2026-01-01x'],
    ['an empty string', ''],
  ])('rejects %s', (_label, v) => expect(isDateISO(v)).toBe(false));

  it.each([undefined, null, 42, ['2026-01-01'], {}])('rejects the non-string %s', (v) => {
    expect(isDateISO(v)).toBe(false);
  });

  // The second half of the damage, and the one with no server error to notice: a
  // shape-only guard let `2026-13-45` through to `addDaysISO`, whose `new Date(…)` is
  // Invalid Date, so the page rendered "NaN-NaN-NaN" into its own prev/next links.
  it('is exactly the guard addDaysISO needs to not emit NaN-NaN-NaN', () => {
    expect(addDaysISO('2026-13-45', 1)).toBe('NaN-NaN-NaN');
    expect(isDateISO('2026-13-45')).toBe(false);
    expect(addDaysISO('2026-01-01', 1)).toBe('2026-01-02');
  });
});
