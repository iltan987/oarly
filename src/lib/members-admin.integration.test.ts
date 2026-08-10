import { randomUUID } from 'node:crypto';

import { asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import {
  assignSkillLevel, type ClubMemberRow, listPendingMembers, searchClubMembers, setMembershipStatus,
} from './members-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('members-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  const tag = (p: string) => `${p}-${Date.now()}-${seq++}`;

  async function mkUser() {
    const id = tag('u');
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  /** One club + one pending membership on it. */
  async function mkPendingMembership() {
    const { id: uid } = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: tag('c'), name: 'C', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, role: 'member', status: 'pending' }).returning();
    return { userId: uid, clubId: club.id, membershipId: m.id };
  }

  /** One club + an approved membership + a skill level of that same club. */
  async function mkApprovedMembershipWithSkill() {
    const { id: uid } = await mkUser();
    const [club] = await db.insert(schema.clubs).values({ slug: tag('c'), name: 'C', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: club.id, role: 'member', status: 'approved' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: club.id, name: 'Beginner', rank: 1 }).returning();
    return { userId: uid, clubId: club.id, membershipId: m.id, skillLevelId: lvl.id };
  }

  it('approves only memberships of the given club', async () => {
    const uid = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1-${randomUUID()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2-${randomUUID()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'approved', actorId: uid })).toBe(false);
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c1.id, status: 'approved', actorId: uid })).toBe(true);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('approved');
  });

  it('rejects a membershipId belonging to a different club without changing it', async () => {
    const uid = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1b-${randomUUID()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2b-${randomUUID()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'rejected', actorId: uid })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('pending');
  });

  it('assigns a skill level from the same club and rejects one from another club', async () => {
    const uid = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1s-${randomUUID()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2s-${randomUUID()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved' }).returning();
    const [lvlSameClub] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();
    const [lvlOtherClub] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Advanced', rank: 1 }).returning();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvlOtherClub.id, actorId: uid })).toBe(false);
    const [afterReject] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(afterReject.skillLevelId).toBeNull();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvlSameClub.id, actorId: uid })).toBe(true);
    const [afterAssign] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(afterAssign.skillLevelId).toBe(lvlSameClub.id);
  });

  it('assignSkillLevel is scoped by clubId on the membership itself', async () => {
    const uid = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1m-${randomUUID()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2m-${randomUUID()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c2.id, skillLevelId: lvl.id, actorId: uid })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.skillLevelId).toBeNull();
  });

  it('does not assign a skill level to a non-approved membership', async () => {
    const uid = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1p-${randomUUID()}`, name: 'C1', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();
    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c1.id, skillLevelId: lvl.id, actorId: uid })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.skillLevelId).toBeNull();
  });

  it('audits member.approve and member.reject with the acting owner', async () => {
    const owner = await mkUser();
    const { clubId, membershipId } = await mkPendingMembership();

    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: owner.id })).toBe(true);
    const approved = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(approved.map((a) => a.action)).toContain('member.approve');
    expect(approved[0].actingAsRole).toBe('owner');
    expect(approved[0].actorUserId).toBe(owner.id);
    expect(approved[0].clubId).toBe(clubId);

    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'rejected', actorId: owner.id })).toBe(true);
    const both = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(both.map((a) => a.action).sort()).toEqual(['member.approve', 'member.reject']);
  });

  it('audits member.skill_assign', async () => {
    const owner = await mkUser();
    const { clubId, membershipId, skillLevelId } = await mkApprovedMembershipWithSkill();
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: owner.id })).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toContain('member.skill_assign');
    expect(rows[0].actingAsRole).toBe('owner');
    expect(rows[0].actorUserId).toBe(owner.id);
  });

  it('rolls the status change back when the audit insert fails', async () => {
    const { clubId, membershipId } = await mkPendingMembership();
    await expect(setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
    expect(after.status).toBe('pending');
  });

  it('rolls the skill assignment back when the audit insert fails', async () => {
    const { clubId, membershipId, skillLevelId } = await mkApprovedMembershipWithSkill();
    await expect(assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
    expect(after.skillLevelId).toBeNull();
  });

  // ── No-op writes must not log a transition that did not occur ──────────────────
  //
  // The audit log's whole value is that a row means the thing happened. A second
  // `member.approve` on an already-approved membership names an actor who took no
  // action, which in a membership dispute is precisely the lie the log exists to
  // prevent. Same argument as `setPlatformAdmin`'s docstring.

  it('does not log a second member.approve when the membership is already approved', async () => {
    const first = await mkUser();
    const second = await mkUser();
    const { clubId, membershipId } = await mkPendingMembership();

    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: first.id })).toBe(true);
    // The stale-page click: a second owner approving a member the first already did.
    // `true`, because the state asked for is the state that holds — but no row.
    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: second.id })).toBe(true);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toEqual(['member.approve']);
    expect(rows[0].actorUserId).toBe(first.id);
  });

  it('does not log a second member.reject when the membership is already rejected', async () => {
    const owner = await mkUser();
    const { clubId, membershipId } = await mkPendingMembership();
    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'rejected', actorId: owner.id })).toBe(true);
    expect(await setMembershipStatus(db, { membershipId, clubId, status: 'rejected', actorId: owner.id })).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toEqual(['member.reject']);
  });

  it('writes one audit row, naming one actor, when two owners approve the same member at once', async () => {
    const ownerA = await mkUser();
    const ownerB = await mkUser();
    const { clubId, membershipId } = await mkPendingMembership();

    // Warm two pool connections FIRST. `db.transaction` calls `pool.connect()`, and on
    // a cold pool the second call spends its first milliseconds on a TCP handshake and
    // auth — by which time the first transaction has committed and the race cannot
    // occur. Without this the test passes even with the compare-and-swap removed.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [a, b] = await Promise.all([
      setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: ownerA.id }),
      setMembershipStatus(db, { membershipId, clubId, status: 'approved', actorId: ownerB.id }),
    ]);
    // Both report success: the membership IS approved, for both callers.
    expect([a, b]).toEqual([true, true]);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows).toHaveLength(1);
    expect([ownerA.id, ownerB.id]).toContain(rows[0].actorUserId);
  });

  it('does not log a member.skill_assign when the member already has that level', async () => {
    const owner = await mkUser();
    const { clubId, membershipId, skillLevelId } = await mkApprovedMembershipWithSkill();
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: owner.id })).toBe(true);
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: owner.id })).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toEqual(['member.skill_assign']);
  });

  it('does not log a member.skill_assign when clearing a level the member never had', async () => {
    const owner = await mkUser();
    const { clubId, membershipId } = await mkApprovedMembershipWithSkill();
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId: null, actorId: owner.id })).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows).toHaveLength(0);
  });

  it('still logs a REAL clear, which the null-safe distinctness guard is there for', async () => {
    // `ne(skill_level_id, null)` is `col <> NULL` — NULL, matching nothing — so a
    // naive guard would make "clear this member's level" silently unwritable. This is
    // the test that catches that.
    const owner = await mkUser();
    const { clubId, membershipId, skillLevelId } = await mkApprovedMembershipWithSkill();
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId, actorId: owner.id })).toBe(true);
    expect(await assignSkillLevel(db, { membershipId, clubId, skillLevelId: null, actorId: owner.id })).toBe(true);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, membershipId));
    expect(after.skillLevelId).toBeNull();
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, membershipId));
    expect(rows.map((a) => a.action)).toEqual(['member.skill_assign', 'member.skill_assign']);
  });

  it('writes no audit row for a membership that does not match the club', async () => {
    const owner = await mkUser();
    const { clubId } = await mkPendingMembership();
    // A fresh uuid per run, not a fixed sentinel: the test database is shared and
    // long-lived, so a constant target would pick up any row an earlier run left
    // behind and fail for a reason that has nothing to do with this call.
    const ghost = randomUUID();
    expect(await setMembershipStatus(db, { membershipId: ghost, clubId, status: 'approved', actorId: owner.id })).toBe(false);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ghost));
    expect(rows).toHaveLength(0);
  });

  // ── The two read paths behind /manage/members ──────────────────────────────────
  describe('the roster loaders', () => {
    async function mkClub() {
      const [club] = await db.insert(schema.clubs)
        .values({ slug: `r-${randomUUID()}`, name: 'Roster Club', status: 'active' }).returning();
      return club;
    }

    /** One user + one membership of `clubId`. Every id is a fresh uuid: a sentinel would
     *  survive a failed run as an orphan and make the next run pass in isolation. */
    async function mkMember(
      clubId: string,
      opts: { name: string; status?: 'pending' | 'approved' | 'rejected' | 'banned'; email?: string; joinedAt?: Date },
    ) {
      const id = randomUUID();
      const email = opts.email ?? `${id}@t.co`;
      await db.insert(schema.user).values({ id, name: opts.name, email });
      const [m] = await db.insert(schema.memberships).values({
        userId: id, clubId, role: 'member', status: opts.status ?? 'approved',
        ...(opts.joinedAt ? { joinedAt: opts.joinedAt } : {}),
      }).returning();
      return { userId: id, email, membershipId: m.id };
    }

    const userIds = (r: { rows: ClubMemberRow[] }) => r.rows.map((row) => row.userId);

    /**
     * The tie-break, and the shape of this fixture is the whole test: every member shares
     * ONE name, so `ORDER BY name` alone leaves Postgres free to return the tied rows in
     * whatever order each execution happens to produce — and a LIMIT/OFFSET query plans
     * differently from its own next page. A fixture with distinct names proves nothing at
     * all here: it passes under any ordering, including none.
     *
     * The expected order is read back FROM POSTGRES rather than sorted in JS, because
     * `user.id` is `text` and its ordering is the database's collation, not JavaScript's
     * `<`. That makes the assertion exact instead of approximately right.
     */
    it('does not let two members with the same name overlap or vanish across pages', async () => {
      const club = await mkClub();
      const name = `Mehmet ${randomUUID().slice(0, 8)}`;
      const made = [];
      for (let i = 0; i < 10; i++) made.push(await mkMember(club.id, { name }));

      const ordered = await db.select({ id: schema.user.id }).from(schema.user)
        .where(inArray(schema.user.id, made.map((m) => m.userId)))
        .orderBy(asc(schema.user.id));
      const expected = ordered.map((r) => r.id);

      const first = await searchClubMembers(db, { clubId: club.id, page: 1, pageSize: 5 });
      const second = await searchClubMembers(db, { clubId: club.id, page: 2, pageSize: 5 });

      expect(userIds(first)).toEqual(expected.slice(0, 5));
      expect(userIds(second)).toEqual(expected.slice(5));
      // Stated as the property as well as the mechanism: nobody on both pages, nobody on
      // neither. A member who lands on neither page is one who quietly never gets a level.
      expect(new Set([...userIds(first), ...userIds(second)]).size).toBe(10);
      expect(userIds(first).filter((id) => userIds(second).includes(id))).toEqual([]);
    });

    // The count is taken BEFORE the page is resolved, because the clamp needs it. Asking
    // for page 99 of a 3-page list must show page 3 — not an empty page above a row range
    // that describes rows nobody can see, with a Previous link into another empty page.
    it('clamps a page past the end down to the last page that has rows', async () => {
      const club = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      for (let i = 0; i < 5; i++) await mkMember(club.id, { name: `${stamp}-${i}` });

      const res = await searchClubMembers(db, { clubId: club.id, page: 99, pageSize: 2 });
      expect(res.total).toBe(5);
      expect(res.page).toBe(3);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].name).toBe(`${stamp}-4`);
    });

    it.each([
      ['a fraction', 1.5],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a huge float', 1e20],
      ['zero', 0],
    ] as const)('answers a query asking for %s of a page instead of raising from Postgres', async (_label, page) => {
      const club = await mkClub();
      await mkMember(club.id, { name: 'Solo' });
      const res = await searchClubMembers(db, { clubId: club.id, page, pageSize: 2 });
      expect(res.page).toBe(1);
      expect(res.rows).toHaveLength(1);
    });

    it('matches a case-insensitive fragment of either the name or the email', async () => {
      const club = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      const hit = await mkMember(club.id, { name: `Zeynep ${stamp}`, email: `zey-${stamp}@t.co` });
      await mkMember(club.id, { name: 'Somebody Else' });

      expect(userIds(await searchClubMembers(db, { clubId: club.id, q: `ZEYNEP ${stamp}` }))).toEqual([hit.userId]);
      expect(userIds(await searchClubMembers(db, { clubId: club.id, q: `ZEY-${stamp}` }))).toEqual([hit.userId]);
    });

    // `_` is a single-character wildcard unescaped, so this search would also return the
    // `litX…` member — a result set quietly too WIDE, with nothing on screen to explain it.
    it('treats LIKE metacharacters in the query as literal text', async () => {
      const club = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      const literal = await mkMember(club.id, { name: `lit_${stamp}` });
      await mkMember(club.id, { name: `litX${stamp}` });

      const res = await searchClubMembers(db, { clubId: club.id, q: `lit_${stamp}` });
      expect(userIds(res)).toEqual([literal.userId]);
      expect(res.total).toBe(1);
    });

    // The roster is one club's. A club_id dropped from the WHERE would leak every other
    // tenant's members into this owner's page, which is the worst failure on this route.
    it('never returns a member of another club', async () => {
      const mine = await mkClub();
      const theirs = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      const ours = await mkMember(mine.id, { name: `shared ${stamp}` });
      await mkMember(theirs.id, { name: `shared ${stamp}` });

      const res = await searchClubMembers(db, { clubId: mine.id, q: stamp });
      expect(userIds(res)).toEqual([ours.userId]);
      expect(res.total).toBe(1);
    });

    /**
     * `banned` belongs on the roster and `pending` and `rejected` do not — the same split
     * the page renders. A banned member is still a member (they carry a badge and a skill
     * level); a rejected one has no surface in the product at all, and a pending one is
     * the work queue's, not the roster's.
     */
    it('returns approved and banned members, and neither pending nor rejected ones', async () => {
      const club = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      const approved = await mkMember(club.id, { name: `a ${stamp}`, status: 'approved' });
      const banned = await mkMember(club.id, { name: `b ${stamp}`, status: 'banned' });
      await mkMember(club.id, { name: `p ${stamp}`, status: 'pending' });
      await mkMember(club.id, { name: `r ${stamp}`, status: 'rejected' });

      const res = await searchClubMembers(db, { clubId: club.id, q: stamp });
      expect(res.total).toBe(2);
      expect(new Set(userIds(res))).toEqual(new Set([approved.userId, banned.userId]));
      expect(res.rows.map((r) => r.status).sort()).toEqual(['approved', 'banned']);
    });

    it('caps an empty query at the page size rather than returning the whole club', async () => {
      const club = await mkClub();
      for (let i = 0; i < 4; i++) await mkMember(club.id, { name: `cap-${i}` });
      const res = await searchClubMembers(db, { clubId: club.id, pageSize: 2 });
      expect(res.rows).toHaveLength(2);
      expect(res.total).toBe(4);
    });

    /**
     * Pending has no `q` parameter to pass, and that is the design: a join request must
     * not be filterable out from under an owner who typed a name to find somebody else.
     * The assertion is that the queue is complete under a search that matches NONE of it —
     * the fixture's pending names deliberately share nothing with the term.
     */
    it('lists every pending request regardless of what the roster search matched', async () => {
      const club = await mkClub();
      const stamp = randomUUID().slice(0, 8);
      await mkMember(club.id, { name: `approved ${stamp}`, status: 'approved' });
      const p1 = await mkMember(club.id, { name: 'Ayşe Waiting', status: 'pending' });
      const p2 = await mkMember(club.id, { name: 'Burak Waiting', status: 'pending' });

      // The owner searched for the approved member; the queue is unaffected.
      const searched = await searchClubMembers(db, { clubId: club.id, q: stamp });
      expect(searched.total).toBe(1);

      const pending = await listPendingMembers(db, { clubId: club.id });
      expect(pending.total).toBe(2);
      expect(new Set(userIds(pending))).toEqual(new Set([p1.userId, p2.userId]));
      expect(pending.rows.every((r) => r.status === 'pending')).toBe(true);
    });

    // Oldest first: the longest-waiting request has already cost the club the most, and
    // must not be pushed under newer ones by the cap.
    it('puts the longest-waiting request first and counts the ones past the cap', async () => {
      const club = await mkClub();
      const oldest = await mkMember(club.id, { name: 'Oldest', status: 'pending', joinedAt: new Date('2020-01-01T00:00:00Z') });
      const middle = await mkMember(club.id, { name: 'Middle', status: 'pending', joinedAt: new Date('2021-01-01T00:00:00Z') });
      await mkMember(club.id, { name: 'Newest', status: 'pending', joinedAt: new Date('2022-01-01T00:00:00Z') });

      const capped = await listPendingMembers(db, { clubId: club.id, cap: 2 });
      expect(userIds(capped)).toEqual([oldest.userId, middle.userId]);
      // The total is counted before the cap, so the page can say "+1 more" — a number to
      // keep going from, rather than a pager to leave people behind.
      expect(capped.total).toBe(3);
    });

    it('does not put another club\'s pending request in this club\'s queue', async () => {
      const mine = await mkClub();
      const theirs = await mkClub();
      const ours = await mkMember(mine.id, { name: 'Ours', status: 'pending' });
      await mkMember(theirs.id, { name: 'Theirs', status: 'pending' });

      const pending = await listPendingMembers(db, { clubId: mine.id });
      expect(userIds(pending)).toEqual([ours.userId]);
      expect(pending.total).toBe(1);
    });

    it('carries the skill level and the ban date the page renders from', async () => {
      const club = await mkClub();
      const [lvl] = await db.insert(schema.skillLevels)
        .values({ clubId: club.id, name: 'Beginner', rank: 1 }).returning();
      const until = new Date('2030-06-01T09:00:00Z');
      const m = await mkMember(club.id, { name: `lvl-${randomUUID().slice(0, 8)}`, status: 'banned' });
      await db.update(schema.memberships).set({ skillLevelId: lvl.id, bannedUntil: until })
        .where(eq(schema.memberships.id, m.membershipId));

      const res = await searchClubMembers(db, { clubId: club.id, q: m.email });
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]).toMatchObject({
        membershipId: m.membershipId, userId: m.userId, email: m.email,
        skillLevelId: lvl.id, status: 'banned',
      });
      expect(res.rows[0].bannedUntil?.toISOString()).toBe(until.toISOString());
    });
  });
});
