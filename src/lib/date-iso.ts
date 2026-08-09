/**
 * Is a URL- or form-supplied string a REAL calendar date in `YYYY-MM-DD` form?
 *
 * It lives in one place for the same reason `isUuid` does (see `uuid.ts`): the failure
 * it prevents is not visible at the call site, and it had already been hand-written
 * three times as a bare shape check that lets the failure through.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` accepts `2026-02-31` and `2026-13-45`. Those are not
 * harmless:
 *
 *   - bound into a `date` column they raise `date/time field value out of range`
 *     (22008) out of the render — the same class of 500 as `?page=1.5` reaching
 *     `OFFSET` as a bigint, or `?clubId=abc` reaching a `uuid`; and
 *   - fed to `addDaysISO`, `new Date('2026-13-45T00:00:00Z')` is Invalid Date, so the
 *     helper emits the string `"NaN-NaN-NaN"`, which the bookings page then puts in
 *     its own prev/next links — every subsequent click carrying the corruption
 *     forward.
 *
 * `?date` is the most reachable instance of the class this cycle has now found five
 * times: a hand-edited URL or a stale bookmark is enough, no crafted POST needed.
 *
 * Range-checked arithmetically rather than through `Date`: `Date.UTC(y, …)` remaps
 * years 0-99 into the 1900s, so a `Date` round-trip would reject the legitimate
 * `0096-02-29` and accept nothing useful in exchange. Postgres `date` uses the
 * proleptic Gregorian calendar, which is the leap rule below.
 */
const SHAPE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Shape AND validity. A valid date still need not be a date anything happened on. */
export function isDateISO(value: unknown): value is string {
  if (typeof value !== 'string' || !SHAPE_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= maxDay;
}
