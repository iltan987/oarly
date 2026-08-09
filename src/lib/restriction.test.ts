import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';

import type { DB } from '@/db';

import { checkEligibility } from './eligibility';
import { type CauseRow, getRestriction, getRestrictions, pickCause, restrictionState } from './restriction';

/**
 * A real drizzle instance over a recording client (the technique `user-profile.test.ts`
 * introduced). Nothing connects: `query` resolves with an empty result set. What it buys
 * here is the only cheap way to see the SHAPE of the read — the two LEFT joins and the
 * `or(...)` predicate are invisible to any assertion on the returned map, because a query
 * with an inner join or a bare `gt` returns a perfectly well-formed map with fewer causes
 * in it.
 */
function recordingDb() {
  const queries: { text: string; params: unknown[] }[] = [];
  const client = {
    query: (q: { text: string }, params: unknown[]) => {
      queries.push({ text: q.text, params });
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  };
  return { db: drizzle(client as never) as unknown as DB, queries };
}

/** A `DB` that makes any read a test failure. Used to prove the short-circuit exists. */
const explodingDb = {
  select() {
    throw new Error('getRestrictions issued a query when nothing was restricted');
  },
} as unknown as DB;

const row = (over: Partial<CauseRow> = {}): CauseRow => ({
  id: randomUUID(),
  reason: 'no_show',
  bannedUntil: null,
  permanent: false,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  sessionStartAt: null,
  ...over,
});

describe('restrictionState', () => {
  /**
   * THE boundary test. `bannedUntil` and `now` are the SAME object, not two
   * `new Date()` calls: two separate calls are microseconds apart, and the test then
   * passes under `>` AND under `>=`, proving nothing about the operator it exists to pin.
   *
   * The operator has to be `>` because `checkEligibility` uses `>` (eligibility.ts:27).
   * At exactly this instant the member CAN book, so the badge must not say otherwise.
   */
  it('is none at exactly bannedUntil, matching checkEligibility at the same instant', () => {
    const instant = new Date('2026-08-09T07:00:00.000Z');
    expect(restrictionState({ status: 'approved', bannedUntil: instant }, instant)).toBe('none');

    // Pinned against the real gate rather than a comment about it: if someone relaxes
    // one of the two operators, these two lines disagree and this test fails.
    const eligible = checkEligibility({
      membershipStatus: 'approved', bannedUntil: instant, memberSkillRank: null, boatMinSkillRank: null,
      boatAllowedPayment: 'both', paymentType: 'regular', clubMultisportEnabled: true, now: instant,
    });
    expect(eligible.ok).toBe(true);
  });

  it('is paused one millisecond before bannedUntil', () => {
    const now = new Date('2026-08-09T07:00:00.000Z');
    const endsAt = new Date(now.getTime() + 1);
    expect(restrictionState({ status: 'approved', bannedUntil: endsAt }, now)).toBe('paused');
  });

  /**
   * `bannedUntil` is NULL here, and that is the whole test. A fixture that sets both
   * `status: 'banned'` and a future `bannedUntil` returns 'suspended' either way — with
   * the status branch or with only the date branch — so it cannot kill the mutation.
   *
   * NULL is also the realistic shape: `recomputeBan` writes `resolveBan(...).bannedUntil`,
   * which is null when the member's only live row is the permanent one.
   */
  it('is suspended for a permanent penalty, which carries no end date at all', () => {
    const now = new Date('2026-08-09T07:00:00.000Z');
    expect(restrictionState({ status: 'banned', bannedUntil: null }, now)).toBe('suspended');
  });

  /**
   * Order, not just presence: a permanent ban whose leftover timed date has already
   * lapsed must still be 'suspended'. Test the date first and this returns 'none' —
   * an expelled member shown as a member in good standing.
   */
  it('is suspended when status is banned even though the leftover date has lapsed', () => {
    const now = new Date('2026-08-09T07:00:00.000Z');
    const past = new Date('2026-07-01T00:00:00.000Z');
    expect(restrictionState({ status: 'banned', bannedUntil: past }, now)).toBe('suspended');
  });

  // penaltyEndsAt anchors to the missed session, so marking an old absence under a short
  // policy writes a ban that has already expired. It must not restrict anybody.
  it('is none for a lapsed penalty on an approved membership', () => {
    const now = new Date('2026-08-09T07:00:00.000Z');
    expect(restrictionState({ status: 'approved', bannedUntil: new Date('2026-07-01T00:00:00.000Z') }, now)).toBe('none');
  });

  it('is none for a membership that was never banned', () => {
    expect(restrictionState({ status: 'approved', bannedUntil: null }, new Date())).toBe('none');
  });
});

describe('pickCause', () => {
  /**
   * The fixture the brief specifies, and the only shape that separates the two rules.
   * `resolveBan` is a MAX, so the 1-month penalty written last week is still the one
   * biting; the 2-day penalty written yesterday changed nothing. Two rows with the SAME
   * end date pass under "newest row wins" as well, which is why the dates differ here.
   */
  it('names the ban in force, not the newest row', () => {
    const oldSession = new Date('2026-07-05T05:00:00.000Z');
    const newSession = new Date('2026-08-05T05:00:00.000Z');
    const oneMonth = new Date('2026-08-20T05:00:00.000Z');
    const twoDays = new Date('2026-08-10T05:00:00.000Z');

    const rows = [
      row({ createdAt: new Date('2026-08-01T00:00:00.000Z'), bannedUntil: oneMonth, sessionStartAt: oldSession }),
      row({ createdAt: new Date('2026-08-06T00:00:00.000Z'), bannedUntil: twoDays, sessionStartAt: newSession }),
    ];

    // membership.bannedUntil is the MAX, i.e. the 1-month date.
    const cause = pickCause(rows, 'paused', oneMonth);
    expect(cause?.sessionStartAt?.toISOString()).toBe(oldSession.toISOString());
  });

  it('breaks a tie between two rows ending at the same instant with the newest', () => {
    const endsAt = new Date('2026-08-20T05:00:00.000Z');
    const older = new Date('2026-07-05T05:00:00.000Z');
    const newer = new Date('2026-08-05T05:00:00.000Z');
    const rows = [
      row({ createdAt: new Date('2026-08-01T00:00:00.000Z'), bannedUntil: endsAt, sessionStartAt: older }),
      row({ createdAt: new Date('2026-08-06T00:00:00.000Z'), bannedUntil: endsAt, sessionStartAt: newer }),
    ];
    expect(pickCause(rows, 'paused', endsAt)?.sessionStartAt?.toISOString()).toBe(newer.toISOString());
  });

  // Stale membership row (or a hand-edited banned_until): still explain something.
  it('falls back to the newest live row when nothing matches the membership date', () => {
    const newer = new Date('2026-08-05T05:00:00.000Z');
    const rows = [
      row({ createdAt: new Date('2026-08-01T00:00:00.000Z'), bannedUntil: new Date('2026-08-20T05:00:00.000Z') }),
      row({ createdAt: new Date('2026-08-06T00:00:00.000Z'), bannedUntil: new Date('2026-08-11T05:00:00.000Z'), sessionStartAt: newer }),
    ];
    expect(pickCause(rows, 'paused', new Date('2030-01-01T00:00:00.000Z'))?.sessionStartAt?.toISOString()).toBe(newer.toISOString());
  });

  /**
   * A suspension is caused by PERMANENCE, so only a permanent row can explain it — even
   * when a timed row is newer. "Newest row wins" would name a session whose 2-day ban is
   * irrelevant to a member who has been expelled.
   */
  it('explains a suspension with the permanent row, not the newer timed one', () => {
    const permanentSession = new Date('2026-07-05T05:00:00.000Z');
    const rows = [
      row({ createdAt: new Date('2026-08-01T00:00:00.000Z'), permanent: true, bannedUntil: null, sessionStartAt: permanentSession }),
      row({ createdAt: new Date('2026-08-06T00:00:00.000Z'), bannedUntil: new Date('2026-08-11T05:00:00.000Z'), sessionStartAt: new Date('2026-08-05T05:00:00.000Z') }),
    ];
    expect(pickCause(rows, 'suspended', null)?.sessionStartAt?.toISOString()).toBe(permanentSession.toISOString());
  });

  it('returns null rather than inventing a cause when no row explains the state', () => {
    expect(pickCause([], 'suspended', null)).toBeNull();
    expect(pickCause([row({ bannedUntil: new Date('2026-08-11T05:00:00.000Z') })], 'suspended', null)).toBeNull();
  });

  // The column is free text; the type is a closed union. Everything unrecognised is 'other'.
  it('maps every reason that is not exactly no_show to other', () => {
    const endsAt = new Date('2026-08-20T05:00:00.000Z');
    expect(pickCause([row({ reason: 'no_show', bannedUntil: endsAt })], 'paused', endsAt)?.reason).toBe('no_show');
    expect(pickCause([row({ reason: 'conduct', bannedUntil: endsAt })], 'paused', endsAt)?.reason).toBe('other');
    expect(pickCause([row({ reason: 'No_Show', bannedUntil: endsAt })], 'paused', endsAt)?.reason).toBe('other');
  });
});

describe('getRestrictions — the short-circuit', () => {
  /**
   * `expect(map.size).toBe(0)` would pass with or without the short-circuit, because a
   * driver may render `inArray(col, [])` as a constant-false predicate and return zero
   * rows anyway. The assertion that bites is that NO STATEMENT WAS BUILT.
   */
  it('issues no query for an empty list', async () => {
    const { db, queries } = recordingDb();
    const map = await getRestrictions(db, []);
    expect(queries).toHaveLength(0);
    expect(map.size).toBe(0);
  });

  /**
   * The valuable case, and the apex root page's real hot path: a member with several
   * clubs and no restriction anywhere. This must cost zero extra round trips.
   */
  it('issues no query when every membership is unrestricted', async () => {
    const { db, queries } = recordingDb();
    const now = new Date('2026-08-09T07:00:00.000Z');
    const ms = [
      { id: randomUUID(), status: 'approved', bannedUntil: null },
      { id: randomUUID(), status: 'pending', bannedUntil: null },
      { id: randomUUID(), status: 'approved', bannedUntil: new Date('2026-07-01T00:00:00.000Z') },
    ];
    const map = await getRestrictions(db, ms, now);

    expect(queries).toHaveLength(0);
    expect([...map.values()].map((r) => r.state)).toEqual(['none', 'none', 'none']);
  });

  // Same property, through the convenience wrapper — it must not grow its own query.
  it('issues no query for a single unrestricted membership', async () => {
    const r = await getRestriction(explodingDb, { id: randomUUID(), status: 'approved', bannedUntil: null });
    expect(r).toEqual({ state: 'none' });
  });

  it('does query once something is restricted', async () => {
    const { db, queries } = recordingDb();
    const now = new Date('2026-08-09T07:00:00.000Z');
    await getRestrictions(db, [{ id: randomUUID(), status: 'banned', bannedUntil: null }], now);
    expect(queries).toHaveLength(1);
  });
});

describe('getRestrictions — the shape of the read', () => {
  const now = new Date('2026-08-09T07:00:00.000Z');
  const suspended = { id: randomUUID(), status: 'banned', bannedUntil: null };

  async function emitted() {
    const { db, queries } = recordingDb();
    await getRestrictions(db, [suspended], now);
    return queries[0];
  }

  /**
   * Both hops LEFT, asserted on the emitted SQL because no assertion on the returned map
   * can see them. `penalties.session_id` is `on delete set null`; `sessions.slot_id` is
   * NOT NULL, so hop 2 looks safe — it is not. With hop 2 as an INNER join, a penalty
   * whose session_id is NULL produces NULL columns from hop 1, then `slots.id = NULL` is
   * unknown and the row is dropped. An inner join at EITHER hop loses the same rows.
   */
  it('LEFT joins at both hops, penalties -> sessions -> slots', async () => {
    const { text } = await emitted();
    expect(text).toMatch(/left join "sessions"/);
    expect(text).toMatch(/left join "slots"/);
    expect(text).not.toMatch(/inner join/);
  });

  // sessions carry no time of their own — slots.start_at is the only timestamp there is.
  it('reads the session time from slots.start_at', async () => {
    const { text } = await emitted();
    expect(text).toMatch(/"slots"\."start_at"/);
  });

  /**
   * A permanent penalty has `banned_until IS NULL`; `NULL > now()` is UNKNOWN, so a bare
   * `gt` drops it and the most serious restriction becomes the only unexplained one.
   */
  it('matches permanent rows OR live timed rows, never the timed ones alone', async () => {
    const { text, params } = await emitted();
    expect(text).toMatch(/"penalties"\."permanent" = \$\d+ or "penalties"\."banned_until" > \$\d+/);
    // `now` really is the bound value, not a stray `new Date()` inside the builder.
    expect(params.map((p) => (p instanceof Date ? p.toISOString() : String(p)))).toContain(now.toISOString());
  });

  /** Only restricted ids reach the IN list; the healthy memberships are never asked about. */
  it('sends only the restricted membership ids', async () => {
    const { db, queries } = recordingDb();
    const healthy = { id: randomUUID(), status: 'approved', bannedUntil: null };
    await getRestrictions(db, [healthy, suspended], now);

    const { params } = queries[0];
    expect(params).toContain(suspended.id);
    expect(params).not.toContain(healthy.id);
  });

  /** Every id asked about comes back, restricted or not — callers never index a hole. */
  it('returns an entry for every membership, including the unrestricted ones', async () => {
    const { db } = recordingDb();
    const healthy = { id: randomUUID(), status: 'approved', bannedUntil: null };
    const map = await getRestrictions(db, [healthy, suspended], now);

    expect(map.get(healthy.id)).toEqual({ state: 'none' });
    // No rows came back from the recording client, so the cause is honestly null.
    expect(map.get(suspended.id)).toEqual({ state: 'suspended', cause: null });
  });

  it('carries the membership end date onto a paused restriction', async () => {
    const { db } = recordingDb();
    const endsAt = new Date('2026-08-20T05:00:00.000Z');
    const paused = { id: randomUUID(), status: 'approved', bannedUntil: endsAt };
    const map = await getRestrictions(db, [paused], now);

    expect(map.get(paused.id)).toEqual({ state: 'paused', endsAt, cause: null });
  });
});
