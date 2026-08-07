/**
 * Does `err` represent a unique-constraint violation of `constraint`?
 *
 * Drizzle wraps driver errors, so the pg error carrying `code`/`constraint` may
 * sit several links down a `cause` chain. The depth cap also guards against a
 * self-referential chain.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let cur: unknown = err;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (e.code === '23505' && e.constraint === constraint) return true;
    if (e.cause === cur) return false;
    cur = e.cause;
  }
  return false;
}
