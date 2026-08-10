import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DB } from '@/db';
import * as schema from '@/db/schema';

import { getRestriction, getRestrictions, type MembershipRef } from './restriction';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';

/** Frozen clock. Everything below is dated relative to it, never to the wall clock. */
const NOW = new Date('2026-08-09T12:00:00.000Z');
const IN_TWO_DAYS = new Date('2026-08-11T05:00:00.000Z');
const IN_ONE_MONTH = new Date('2026-09-05T05:00:00.000Z');
const LAPSED = new Date('2026-08-01T05:00:00.000Z');

describe.skipIf(!url)('getRestrictions', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  /**
   * Ids come from `randomUUID()`, never from `Date.now()`: measured, `` `x-${Date.now()}` ``
   * yields FOUR distinct values across 20,000 tight-loop calls, so a suite that seeds in a
   * loop collides on the unique indexes. The slug is sliced to 18 chars because
   * `validateSlug` caps at 40 and a prefix plus a full 36-char UUID overflows it.
   */
  async function seedClub() {
    const tag = `rst-${randomUUID().slice(0, 18)}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
    return { club, boat, tag };
  }

  async function seedMembership(
    club: typeof schema.clubs.$inferSelect,
    over: { status?: 'approved' | 'banned'; bannedUntil?: Date | null } = {},
  ) {
    const uid = `rst-u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'Ali', email: `${uid}@t.co` });
    const [m] = await db.insert(schema.memberships).values({
      userId: uid,
      clubId: club.id,
      status: over.status ?? 'approved',
      bannedUntil: over.bannedUntil ?? null,
    }).returning();
    return m;
  }

  /** A slot + its session, at `startAt`. `sessions` carries no time of its own. */
  async function seedSession(club: typeof schema.clubs.$inferSelect, boat: typeof schema.boatTypes.$inferSelect, startAt: Date) {
    const [slot] = await db.insert(schema.slots).values({
      clubId: club.id,
      date: startAt.toISOString().slice(0, 10),
      startAt,
      endAt: new Date(startAt.getTime() + 3_600_000),
    }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 2 }).returning();
    return { slot, session };
  }

  const ref = (m: typeof schema.memberships.$inferSelect): MembershipRef =>
    ({ id: m.id, status: m.status, bannedUntil: m.bannedUntil });

  /**
   * A `DB` whose only job is to fail the test if it is touched.
   *
   * This, and not `expect(map.size).toBe(0)`, is the assertion that proves the
   * short-circuit: node-postgres renders `inArray(col, [])` as a constant-false
   * predicate and returns zero rows, so the size assertion passes identically with the
   * short-circuit deleted. What has to be observed is that NO STATEMENT WAS ISSUED.
   */
  const explodingDb = {
    select() { throw new Error('getRestrictions issued a query when nothing was restricted'); },
  } as unknown as DB;

  it('issues no query at all for an empty membership list', async () => {
    const map = await getRestrictions(explodingDb, [], NOW);
    expect(map.size).toBe(0);
  });

  /**
   * The case that actually matters in production: the apex root page lists every club a
   * member belongs to, and almost every member is in good standing everywhere. That page
   * must not pay for a penalty join to be told nothing is wrong.
   *
   * The third row is a LAPSED ban, which is the interesting one — it is a non-null
   * `banned_until` that must still count as unrestricted and still skip the query.
   */
  it('issues no query when every membership resolves to none, including a lapsed ban', async () => {
    const ms: MembershipRef[] = [
      { id: randomUUID(), status: 'approved', bannedUntil: null },
      { id: randomUUID(), status: 'pending', bannedUntil: null },
      { id: randomUUID(), status: 'approved', bannedUntil: LAPSED },
    ];
    const map = await getRestrictions(explodingDb, ms, NOW);
    expect([...map.values()]).toEqual([{ state: 'none' }, { state: 'none' }, { state: 'none' }]);
  });

  it('resolves a timed pause to its end date and the session that caused it', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    const sessionStart = new Date('2026-08-09T04:00:00.000Z');
    const { session } = await seedSession(club, boat, sessionStart);
    await db.insert(schema.penalties).values({ membershipId: m.id, sessionId: session.id, reason: 'no_show', bannedUntil: IN_TWO_DAYS });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r).toEqual({
      state: 'paused',
      endsAt: IN_TWO_DAYS,
      cause: { reason: 'no_show', sessionStartAt: sessionStart },
    });
  });

  /**
   * `penalties.session_id` is `on delete set null`, and its column comment already
   * anticipates a manually-issued penalty with no session at all. This row must still
   * come back, with `sessionStartAt: null`, so the UI can render the generic copy.
   *
   * This single case kills an INNER join at EITHER hop, which is why it is worth more
   * than it looks. Hop 2 (`sessions -> slots`) appears safe because `sessions.slot_id` is
   * NOT NULL — but with hop 1 outer-joined to NULL, an inner `slots.id = sessions.slot_id`
   * compares against NULL, is UNKNOWN, and drops the row just the same.
   *
   * And it is invisible to a component test: the row vanishes, the loader honestly
   * reports `cause: null`, and the page renders reasonable-looking generic prose. Nothing
   * on screen is wrong; the member simply never learns which session cost them.
   */
  it('keeps a penalty whose session_id is NULL, with a null session time', async () => {
    const { club } = await seedClub();
    const m = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    await db.insert(schema.penalties).values({ membershipId: m.id, sessionId: null, reason: 'no_show', bannedUntil: IN_TWO_DAYS });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r.state).toBe('paused');
    expect(r.state === 'paused' && r.cause).toEqual({ reason: 'no_show', sessionStartAt: null });
  });

  /**
   * A permanent penalty has `banned_until IS NULL`. Under `gt(bannedUntil, now)` alone the
   * comparison is UNKNOWN and the row disappears — leaving the most serious restriction in
   * the product as the only one that can offer no explanation whatsoever.
   */
  it('explains a permanent suspension, whose row carries no end date', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { status: 'banned', bannedUntil: null });
    const sessionStart = new Date('2026-07-02T04:00:00.000Z');
    const { session } = await seedSession(club, boat, sessionStart);
    await db.insert(schema.penalties).values({ membershipId: m.id, sessionId: session.id, reason: 'no_show', bannedUntil: null, permanent: true });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r).toEqual({ state: 'suspended', cause: { reason: 'no_show', sessionStartAt: sessionStart } });
  });

  /**
   * `resolveBan` is a MAX, so the ban being served is the LONGEST one, not the latest one
   * written. Fixture: the older row ends in a month, the newer row ends in two days, and
   * the membership's `banned_until` is the one-month date — exactly what `recomputeBan`
   * would have written. "Newest row wins" passes every other test in this file and names
   * the wrong session here, telling the member their ban lifts on the wrong day.
   */
  it('names the ban in force, not the most recently written row', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { bannedUntil: IN_ONE_MONTH });
    const longSession = new Date('2026-08-05T04:00:00.000Z');
    const shortSession = new Date('2026-08-09T04:00:00.000Z');
    const long = await seedSession(club, boat, longSession);
    const short = await seedSession(club, boat, shortSession);

    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: long.session.id, reason: 'no_show',
      bannedUntil: IN_ONE_MONTH, createdAt: new Date('2026-08-05T06:00:00.000Z'),
    });
    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: short.session.id, reason: 'no_show',
      bannedUntil: IN_TWO_DAYS, createdAt: new Date('2026-08-09T06:00:00.000Z'),
    });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r.state === 'paused' && r.endsAt).toEqual(IN_ONE_MONTH);
    expect(r.state === 'paused' && r.cause?.sessionStartAt).toEqual(longSession);
  });

  /**
   * The other half of the `or(...)`: `gt(bannedUntil, now)` must keep LAPSED rows out of
   * the candidate set entirely.
   *
   * Reaching that requires the FALLBACK path, and the fixture is deliberately awkward
   * about it: no row ends exactly when the membership says the ban does (a hand-edited
   * `banned_until`, or the row that set it since deleted), so `pickCause` cannot match on
   * the date and falls back to the newest live row. The newest row overall is lapsed. Drop
   * the time filter and it wins, naming a session whose ban ended over a week ago.
   *
   * Measured, and worth stating plainly: with a CONSISTENT membership row this predicate
   * half is unobservable in the result. `recomputeBan` writes `resolveBan`'s max over ALL
   * rows including lapsed ones, so whenever the state is 'paused' the membership's date
   * always matches a live row exactly and `pickCause` never consults the rest. This test
   * is the one arrangement where the filter changes the answer; otherwise its value is
   * bounding the rows shipped over the wire, which no assertion here can see.
   */
  it('ignores a lapsed penalty even when it is the newest row', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { bannedUntil: IN_ONE_MONTH });
    const liveSession = new Date('2026-08-05T04:00:00.000Z');
    const staleSession = new Date('2026-07-30T04:00:00.000Z');
    const live = await seedSession(club, boat, liveSession);
    const stale = await seedSession(club, boat, staleSession);

    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: live.session.id, reason: 'no_show',
      bannedUntil: IN_TWO_DAYS, createdAt: new Date('2026-08-05T06:00:00.000Z'),
    });
    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: stale.session.id, reason: 'no_show',
      bannedUntil: LAPSED, createdAt: new Date('2026-08-08T06:00:00.000Z'),
    });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r.state === 'paused' && r.cause?.sessionStartAt).toEqual(liveSession);
  });

  // The column is free text. A reason the writer never promised gets generic copy, not a
  // raw database string leaked into the UI.
  it('maps an unrecognised reason to other', async () => {
    const { club } = await seedClub();
    const m = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    await db.insert(schema.penalties).values({ membershipId: m.id, reason: 'conduct', bannedUntil: IN_TWO_DAYS });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r.state === 'paused' && r.cause?.reason).toBe('other');
  });

  /**
   * The batch is what the apex page calls, so the grouping has to be right: each
   * membership gets ITS OWN cause, and the unrestricted ones in the same call still come
   * back as `none`. A bug that buckets every row under the first id passes every
   * single-membership test above.
   */
  it('keeps causes separated per membership in one batched call', async () => {
    const { club, boat } = await seedClub();
    const paused = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    const suspended = await seedMembership(club, { status: 'banned', bannedUntil: null });
    const healthy = await seedMembership(club);

    const pausedStart = new Date('2026-08-09T04:00:00.000Z');
    const suspendedStart = new Date('2026-06-01T04:00:00.000Z');
    const a = await seedSession(club, boat, pausedStart);
    const b = await seedSession(club, boat, suspendedStart);
    await db.insert(schema.penalties).values({ membershipId: paused.id, sessionId: a.session.id, reason: 'no_show', bannedUntil: IN_TWO_DAYS });
    await db.insert(schema.penalties).values({ membershipId: suspended.id, sessionId: b.session.id, reason: 'no_show', permanent: true });

    const map = await getRestrictions(db, [ref(paused), ref(suspended), ref(healthy)], NOW);

    expect(map.get(paused.id)).toEqual({ state: 'paused', endsAt: IN_TWO_DAYS, cause: { reason: 'no_show', sessionStartAt: pausedStart } });
    expect(map.get(suspended.id)).toEqual({ state: 'suspended', cause: { reason: 'no_show', sessionStartAt: suspendedStart } });
    expect(map.get(healthy.id)).toEqual({ state: 'none' });
  });

  /**
   * A penalty against ANOTHER member of the same club must never explain this one's ban.
   *
   * Both refs go into ONE call on purpose. Asking about `mine` alone proves nothing: the
   * `inArray` never fetches the other row, so the per-membership bucketing is never
   * exercised and a `pickCause` fed every row in the batch would still answer correctly.
   * Two restricted memberships with identical end dates and exactly one penalty between
   * them is the arrangement where a mis-grouped batch attributes it to the wrong person.
   */
  it('never attributes another membership’s penalty', async () => {
    const { club, boat } = await seedClub();
    const mine = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    const theirs = await seedMembership(club, { bannedUntil: IN_TWO_DAYS });
    const sessionStart = new Date('2026-08-09T04:00:00.000Z');
    const { session } = await seedSession(club, boat, sessionStart);
    await db.insert(schema.penalties).values({ membershipId: theirs.id, sessionId: session.id, reason: 'no_show', bannedUntil: IN_TWO_DAYS });

    const map = await getRestrictions(db, [ref(mine), ref(theirs)], NOW);
    expect(map.get(mine.id)).toEqual({ state: 'paused', endsAt: IN_TWO_DAYS, cause: null });
    expect(map.get(theirs.id)).toEqual({ state: 'paused', endsAt: IN_TWO_DAYS, cause: { reason: 'no_show', sessionStartAt: sessionStart } });
  });

  /**
   * The membership is banned but every penalty row explaining it has been deleted (an
   * owner undoing an absence deletes the row). The state still stands — it is read off the
   * membership — but there is honestly nothing left to explain it, and `cause: null` is
   * the correct answer rather than an invented one.
   */
  it('returns a restriction with a null cause when no live row explains it', async () => {
    const { club } = await seedClub();
    const m = await seedMembership(club, { status: 'banned', bannedUntil: null });
    const r = await getRestriction(db, ref(m), NOW);
    expect(r).toEqual({ state: 'suspended', cause: null });
  });

  /**
   * A timed row does NOT explain a permanent suspension: `status = 'banned'` is written by
   * `recomputeBan` only when a permanent row exists, so the permanent row is the one that
   * caused the state. Naming the two-day session instead would tell an expelled member
   * their expulsion is about a session they missed last Tuesday.
   */
  it('explains a suspension with the permanent row even when a timed row is newer', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { status: 'banned', bannedUntil: IN_TWO_DAYS });
    const permanentStart = new Date('2026-06-01T04:00:00.000Z');
    const timedStart = new Date('2026-08-09T04:00:00.000Z');
    const perm = await seedSession(club, boat, permanentStart);
    const timed = await seedSession(club, boat, timedStart);

    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: perm.session.id, reason: 'no_show',
      permanent: true, createdAt: new Date('2026-06-01T06:00:00.000Z'),
    });
    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: timed.session.id, reason: 'no_show',
      bannedUntil: IN_TWO_DAYS, createdAt: new Date('2026-08-09T06:00:00.000Z'),
    });

    const r = await getRestriction(db, ref(m), NOW);
    expect(r).toEqual({ state: 'suspended', cause: { reason: 'no_show', sessionStartAt: permanentStart } });
  });

  /**
   * A penalty an owner has lifted is kept in the table for the audit trail, and must
   * never explain a restriction. `recomputeBan` already drops `lifted_at IS NOT NULL`
   * rows from the fold; this is the other half of the same rule, on the read model.
   *
   * The row set is built by hand because today's write paths cannot produce it: a lift
   * stamps everything in force at once, so the rows still live after one are always
   * newer than the lifted ones and `pickCause` would prefer them anyway. That makes the
   * predicate look redundant right up until something writes a penalty by another route
   * — a manually-issued one, which `penalties.session_id`'s own comment already
   * anticipates. Asserted here so it is a rule rather than a coincidence.
   */
  it('never explains a restriction with a penalty that was lifted', async () => {
    const { club, boat } = await seedClub();
    const m = await seedMembership(club, { status: 'banned', bannedUntil: null });
    const lifted = await seedSession(club, boat, new Date('2026-06-01T04:00:00.000Z'));
    await db.insert(schema.penalties).values({
      membershipId: m.id, sessionId: lifted.session.id, reason: 'no_show',
      permanent: true, createdAt: new Date('2026-06-01T06:00:00.000Z'),
      liftedAt: new Date('2026-06-02T06:00:00.000Z'),
    });

    // No live row is left to explain it, so the cause is honestly absent rather than a
    // suspension the club already withdrew.
    expect(await getRestriction(db, ref(m), NOW)).toEqual({ state: 'suspended', cause: null });
  });
});
