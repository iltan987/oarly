/**
 * Is a URL-supplied string shaped like a uuid?
 *
 * It lives in one place because the failure it prevents is not visible at the call
 * site. A uuid column compares against a bound parameter that Postgres parses as
 * `uuid`, so anything that is not uuid-shaped raises out of the render as a 500 on a
 * URL anyone can type:
 *
 *   /admin/audit?clubId=abc  -> invalid input syntax for type uuid: "abc"   (22P02)
 *   /admin/clubs/foo         -> invalid input syntax for type uuid: "foo"   (22P02)
 *
 * This is the same class of crash as `?page=1.5` reaching `OFFSET` as a bigint, and
 * it gets the same treatment for the same reason (see `pagination.ts`): the guard
 * goes where the next id-keyed route inherits it rather than where it has to be
 * remembered. It had already been written out by hand three times — the audit
 * cursor, the audit club filter, and the club detail route — before it was extracted.
 *
 * What a caller does with `false` is NOT shared, because the right answer differs:
 * a bad *filter* renders an empty list (dropping the filter would answer "which rows
 * belong to club abc" with the whole unfiltered log), while a bad *route parameter*
 * is a 404, because a string that cannot be a club id names no club — exactly like a
 * well-formed id that matches nothing.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape only. A uuid-shaped string still need not name a row that exists. */
export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
