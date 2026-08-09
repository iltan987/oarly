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

/**
 * Escape the `LIKE`/`ILIKE` metacharacters in a user-supplied search term, so a term
 * containing `%`, `_` or `\` matches those characters literally.
 *
 * The `_` is the one that matters, and it is the one a fourth writer drops. `%` is
 * visibly a wildcard, so a term containing one is usually deliberate; `_` is an
 * ordinary character in a slug, an email local part and an audit action
 * (`skill_level.update`), and unescaped it silently matches ANY character. The result
 * is a result set that is quietly too WIDE, with nothing on screen to explain why — and
 * a test that only covers `%` passes against a half-written escape.
 *
 * Backslash is escaped first by the character class, not by a second pass, so a term
 * containing `\%` cannot be double-escaped into a literal backslash followed by a
 * wildcard. Postgres' default `LIKE` escape character is `\`, so no `ESCAPE` clause is
 * needed; the caller wraps the result in whatever `%` it wants.
 *
 * It lives beside `one()` because both do the same job — turning an untrusted string
 * into one that is safe to put in a query — and because this expression was written out
 * verbatim in `users-admin.ts`, `clubs-admin.ts` and `audit.ts` before it was extracted.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
