/**
 * Offset pagination arithmetic, shared by every admin list (users, clubs) and by
 * `AdminPagination`.
 *
 * It lives in one place because the failure it prevents is not obvious from the call
 * site: a page number read out of a URL reaches Postgres as `OFFSET (page - 1) * n`,
 * and Postgres parses that argument as `bigint`. Anything that is not a whole,
 * finite, in-range number raises out of the render as a 500 on a URL anyone can
 * hand-edit:
 *
 *   ?page=1.5       -> invalid input syntax for type bigint: "12.5"
 *   ?page=Infinity  -> invalid input syntax for type bigint: "Infinity"
 *   ?page=1e20      -> invalid input syntax for type bigint: "2.5e+21"
 *
 * `/admin/audit` hardened its cursor against exactly this shape of input; a page
 * number is the same class of value and gets the same treatment.
 */

/**
 * A page nobody can browse to, and an offset that stays a safe integer and a valid
 * `bigint` (1_000_000 pages of 25 is 25M rows). It is a backstop, not the real
 * bound — a list that knows its total clamps to `pageCount` on top of this.
 */
export const MAX_PAGE = 1_000_000;

/**
 * Any URL-supplied value to a whole page number in `[1, MAX_PAGE]`.
 *
 * Fractions floor, so `?page=1.5` is page 1 rather than an offset of 12.5. Negative,
 * zero, `NaN` and non-finite values all become page 1: a page number that cannot be
 * read is not an error condition, it just means "start at the beginning".
 */
export function normalizePage(value: unknown): number {
  const n = Math.floor(Number(value ?? 1));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/** How many pages `total` rows fill. Always at least 1, so an empty list is "page 1 of 1". */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(pageSize) || pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The page actually being shown: normalized, then pulled back to the last page that
 * exists. Asking for page 999 of a 4-page list shows page 4 — which is what makes the
 * row range, the Previous link and the rows themselves describe the same page. Without
 * it, `?page=999` renders the empty state above "24951-100 of 100" and a Previous link
 * into another empty page.
 */
export function clampPage(value: unknown, total: number, pageSize: number): number {
  return Math.min(normalizePage(value), pageCount(total, pageSize));
}
