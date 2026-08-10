import { and, eq, gt, inArray, or } from 'drizzle-orm';

import type { DB } from '@/db';
import { penalties, sessions, slots } from '@/db/schema';

/**
 * Two different restrictions that today collapse into one red "Suspended" pill:
 *
 * - `paused`   — a timed penalty that lifts by itself on a known date.
 * - `suspended`— a permanent penalty. Only a human can lift it.
 *
 * The distinction is the whole point of this module. A member serving a 48-hour
 * cooling-off and a member who has been expelled are not in the same situation,
 * and rendering both as the same badge is what makes the product read as "they
 * banned me and won't say why".
 */
export type RestrictionState = 'none' | 'paused' | 'suspended';

/** Why the restriction exists. `sessionStartAt` is null when penalties.session_id was
 *  nulled by `on delete set null`, or for a manually-issued penalty with no session. */
export type RestrictionCause = { reason: 'no_show' | 'other'; sessionStartAt: Date | null };

export type Restriction =
  | { state: 'none' }
  | { state: 'paused'; endsAt: Date; cause: RestrictionCause | null }
  | { state: 'suspended'; cause: RestrictionCause | null };

export type MembershipRef = { id: string; status: string; bannedUntil: Date | null };

/**
 * The single answer to "is this member restricted, and how?".
 *
 * Deliberately the same predicate, in the same order, as `checkEligibility`
 * (`src/lib/eligibility.ts:22-30`). Two different answers to "am I restricted?" —
 * one gating the Book button and one gating the badge — is worse than either
 * answer on its own, because it produces a screen that says you are free to book
 * next to a booking form that refuses you.
 *
 * The order is load-bearing:
 *
 * - `status === 'banned'` is tested FIRST. A permanent penalty sets
 *   `membership.status = 'banned'` while leaving `banned_until` at whatever the
 *   remaining TIMED rows resolved to — usually `null` (see `recomputeBan` in
 *   `src/lib/attendance.ts`, which writes `resolveBan(...).bannedUntil` verbatim).
 *   Test the date first and a permanent expulsion reports itself as `none`.
 *
 * - Strict `>`, never `>=`. At exactly `bannedUntil === now`, `checkEligibility`
 *   lets the member book, so the UI must agree — a badge saying "paused" above a
 *   form that accepts the booking is the same lie in the other direction.
 *
 * A LAPSED penalty falls out as `none` for free, and that matters more than it
 * looks: `penaltyEndsAt` anchors to the MISSED SESSION rather than to when the
 * owner did the paperwork, so marking an old absence can write a ban that has
 * already expired (`alreadyLapsed` in `MarkNoShowResult` exists for exactly this).
 */
export function restrictionState(
  m: Pick<MembershipRef, 'status' | 'bannedUntil'>,
  now: Date,
): RestrictionState {
  if (m.status === 'banned') return 'suspended';
  if (m.bannedUntil != null && m.bannedUntil.getTime() > now.getTime()) return 'paused';
  return 'none';
}

/** One live penalty row, joined out to the time of the session it came from. */
export type CauseRow = {
  id: string;
  reason: string;
  bannedUntil: Date | null;
  permanent: boolean;
  createdAt: Date;
  sessionStartAt: Date | null;
};

/** The column is free text (`reason: text('reason').notNull()`), so the mapping is closed:
 *  anything the writer did not promise becomes `'other'` and gets the generic copy. */
function toCause(row: CauseRow): RestrictionCause {
  return {
    reason: row.reason === 'no_show' ? 'no_show' : 'other',
    sessionStartAt: row.sessionStartAt,
  };
}

/**
 * Pick the penalty row that EXPLAINS the restriction currently in force — not the
 * newest row.
 *
 * `resolveBan` (`src/lib/penalty.ts`) folds the rows with a max, so the ban being
 * served is the LONGEST one, not the latest one written. A member who misses a
 * session under a 1-month policy and then misses another under a 2-day policy is
 * still serving the 1-month ban; naming the 2-day session in the explanation
 * points them at the wrong date and the wrong session, and "your ban lifts on
 * Wednesday" is then simply false.
 *
 * - `suspended`: the newest row with `permanent = true`. Permanence is what
 *   produced the state, so only a permanent row can explain it.
 * - `paused`: the row whose `bannedUntil` equals the membership's `bannedUntil`,
 *   which is by construction the row `resolveBan`'s max selected. Ties (two rows
 *   ending at the same instant) break to the newest. If no row matches — the
 *   membership row is stale relative to its penalties — fall back to the newest
 *   live row rather than dropping the explanation entirely.
 *
 * Sorting happens HERE rather than in the query's ORDER BY so that "newest" has
 * exactly one definition and it is the one under test. `createdAt` ties are real:
 * `defaultNow()` is transaction time, so rows written in one transaction share an
 * instant — `id` breaks that deterministically.
 */
export function pickCause(
  rows: readonly CauseRow[],
  state: 'paused' | 'suspended',
  endsAt: Date | null,
): RestrictionCause | null {
  const newestFirst = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  if (state === 'suspended') {
    const row = newestFirst.find((r) => r.permanent);
    return row ? toCause(row) : null;
  }
  const inForce = endsAt == null ? undefined : newestFirst.find((r) => r.bannedUntil?.getTime() === endsAt.getTime());
  const row = inForce ?? newestFirst[0];
  return row ? toCause(row) : null;
}

/**
 * The restriction for every membership handed in, keyed by membership id.
 *
 * Every input id is present in the result, so a caller never has to distinguish
 * "not restricted" from "not asked about".
 *
 * ## It does not query at all unless something is actually restricted
 *
 * States are computed from the membership rows the caller already has, and the
 * `inArray` is only CONSTRUCTED once at least one of them is restricted. Two
 * reasons, both load-bearing:
 *
 * 1. This is the hot path. The apex root page lists every club a member belongs
 *    to, and the overwhelmingly common case is that none of them restrict them —
 *    a healthy member must cost zero extra round trips.
 * 2. `inArray(col, [])` has no good rendering: a syntax error in some drivers, a
 *    silent full scan in others. Never let it be built.
 *
 * ## Both joins are LEFT, and both have to be
 *
 * `penalties → sessions → slots`. `penalties.session_id` is `on delete set null`
 * and its column comment already anticipates a manually-issued penalty with no
 * session at all; `sessions` carries no time of its own, so the timestamp the copy
 * needs is `slots.start_at` (see `src/db/schema/schedule.ts`). An INNER join at
 * either hop drops precisely the rows that need the generic "we can't name the
 * session" copy, and the loader then reports `cause: null` — which renders as
 * perfectly reasonable-looking prose. Nothing on screen looks wrong.
 *
 * ## The predicate is an `or`, not `gt(bannedUntil, now)`
 *
 * A permanent penalty has `banned_until IS NULL`. `NULL > now()` is unknown, not
 * false, so a bare `gt` silently discards it — leaving the single most serious
 * restriction as the only one with no explanation attached.
 */
export async function getRestrictions(
  db: DB,
  ms: readonly MembershipRef[],
  now: Date = new Date(),
): Promise<Map<string, Restriction>> {
  const states = new Map<string, RestrictionState>();
  const restricted: MembershipRef[] = [];
  for (const m of ms) {
    const state = restrictionState(m, now);
    states.set(m.id, state);
    if (state !== 'none') restricted.push(m);
  }

  const out = new Map<string, Restriction>();
  if (restricted.length === 0) {
    for (const id of states.keys()) out.set(id, { state: 'none' });
    return out;
  }

  const rows = await db
    .select({
      id: penalties.id,
      membershipId: penalties.membershipId,
      reason: penalties.reason,
      bannedUntil: penalties.bannedUntil,
      permanent: penalties.permanent,
      createdAt: penalties.createdAt,
      sessionStartAt: slots.startAt,
    })
    .from(penalties)
    .leftJoin(sessions, eq(sessions.id, penalties.sessionId))
    .leftJoin(slots, eq(slots.id, sessions.slotId))
    .where(
      and(
        inArray(penalties.membershipId, restricted.map((m) => m.id)),
        or(eq(penalties.permanent, true), gt(penalties.bannedUntil, now)),
      ),
    );

  const byMembership = new Map<string, CauseRow[]>();
  for (const r of rows) {
    const bucket = byMembership.get(r.membershipId) ?? [];
    bucket.push(r);
    byMembership.set(r.membershipId, bucket);
  }

  for (const m of ms) {
    const state = states.get(m.id)!;
    if (state === 'none') {
      out.set(m.id, { state: 'none' });
      continue;
    }
    const cause = pickCause(byMembership.get(m.id) ?? [], state, m.bannedUntil);
    // `restrictionState` returns 'paused' only when bannedUntil is a future date,
    // so the non-null assertion is that invariant, not an assumption about the row.
    out.set(m.id, state === 'paused' ? { state, endsAt: m.bannedUntil!, cause } : { state, cause });
  }
  return out;
}

/**
 * Single-club convenience. Implemented VIA `getRestrictions` rather than beside it:
 * a second query with its own joins and its own predicate is a second thing to keep
 * correct, and the two would drift the first time only one of them was fixed.
 */
export async function getRestriction(db: DB, m: MembershipRef, now: Date = new Date()): Promise<Restriction> {
  const map = await getRestrictions(db, [m], now);
  return map.get(m.id) ?? { state: 'none' };
}
