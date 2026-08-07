import { addDaysISO, addMonthsISO, utcToClubDate, zonedWallClockToUtc } from './date-tz';

export type NoshowPolicy = 'off' | '2d' | '1w' | '2w' | '1m' | 'never';

/** A live penalty row, reduced to what the ban calculation needs. */
export type PenaltyRow = { bannedUntil: Date | null; permanent: boolean };

/**
 * When a single no-show penalty stops biting.
 *
 * Anchored to the MISSED SESSION, never to the moment the owner got around to
 * marking it — so the cost of an absence does not depend on the owner's
 * paperwork habits. A consequence, intended: marking an old absence under a
 * short policy produces a ban that is already expired. It is still recorded.
 *
 * The arithmetic runs in club-local wall clock, so a 07:00 session yields a ban
 * ending at 07:00 even across a DST boundary — `+ N * 24h` would drift an hour.
 *
 * Returns `null` for `off` (no ban, but the absence is still recorded) and the
 * marker `'permanent'` for `never` (no end date exists to compute).
 */
export function penaltyEndsAt(input: { sessionStartAt: Date; timezone: string; policy: NoshowPolicy }): Date | 'permanent' | null {
  if (input.policy === 'off') return null;
  if (input.policy === 'never') return 'permanent';

  const { dateISO } = utcToClubDate(input.sessionStartAt, input.timezone);
  const endISO =
    input.policy === '2d' ? addDaysISO(dateISO, 2)
    : input.policy === '1w' ? addDaysISO(dateISO, 7)
    : input.policy === '2w' ? addDaysISO(dateISO, 14)
    : addMonthsISO(dateISO, 1);

  // Reuse the session's own club-local time of day so the ban ends at the same
  // wall-clock hour it started counting from.
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(input.sessionStartAt);
  return zonedWallClockToUtc(endISO, hhmm, input.timezone);
}

/**
 * The member's effective ban, folded from their remaining penalty rows.
 *
 * A plain max, therefore commutative: row order is irrelevant and recomputation
 * after a row is deleted needs no cursor or replay. That property is what makes
 * undoing a mistaken absence correct by construction.
 */
export function resolveBan(rows: PenaltyRow[]): { bannedUntil: Date | null; permanent: boolean } {
  let bannedUntil: Date | null = null;
  let permanent = false;
  for (const r of rows) {
    if (r.permanent) permanent = true;
    if (r.bannedUntil && (bannedUntil === null || r.bannedUntil.getTime() > bannedUntil.getTime())) {
      bannedUntil = r.bannedUntil;
    }
  }
  return { bannedUntil, permanent };
}
