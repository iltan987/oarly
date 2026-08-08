/**
 * Any query parameter can repeat — `?q=a&q=b` arrives as a `string[]`, not a string.
 * Every admin list reads its parameters with string methods (`.trim()`, `Number(...)`,
 * a uuid test), so an unguarded array value throws a TypeError out of the render before
 * a single row is fetched.
 *
 * First occurrence wins, matching `URLSearchParams.get`, which is what builds these
 * links on the way back out — so a repeated parameter round-trips to the same page
 * rather than to a different one.
 *
 * It lives here because it had been written out by hand on `/admin/audit` and
 * `/admin/users` before `/admin` needed the third copy, and the next id-keyed list
 * should inherit it rather than have to remember it — the same reason `isUuid` and
 * `normalizePage` were extracted.
 */
export function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
