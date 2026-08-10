import { randomUUID } from 'node:crypto';

import { asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { markNoShow } from './attendance';
import { bookSeat } from './booking';
import { utcToClubDate, zonedWallClockToUtc } from './date-tz';
import {
  assignSkillLevel, type ClubMemberRow, liftPenalties, listPendingMembers, MEMBERS_PAGE_SIZE,
  PENDING_CAP, searchClubMembers, setMembershipStatus,
} from './members-admin';
import { resolveBan } from './penalty';
import { getRestriction, restrictionState } from './restriction';

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

    /**
     * The two constants, pinned by behaviour rather than by `expect(X).toBe(25)`.
     *
     * Both defaults were reachable only through `opts.pageSize ?? …` / `opts.cap ?? …`,
     * and every existing test passes an explicit value — so setting either constant to 7
     * left the whole suite green while a live 200-member club silently changed its page
     * size, its row range and its pending cap. These two call the loaders the way the
     * ROUTE's defaults would if the page ever stopped passing them, and assert the size
     * of what comes back.
     *
     * 26 rows, not 25, so the cap is observed cutting something off: a fixture the size of
     * the page size cannot tell "limit 25" from "no limit at all".
     */
    it('defaults to a page of MEMBERS_PAGE_SIZE rows when no pageSize is given', async () => {
      const club = await mkClub();
      for (let i = 0; i < MEMBERS_PAGE_SIZE + 1; i++) await mkMember(club.id, { name: `Def ${String(i).padStart(2, '0')}` });

      const res = await searchClubMembers(db, { clubId: club.id });
      expect(MEMBERS_PAGE_SIZE).toBe(25);
      expect(res.pageSize).toBe(25);
      expect(res.rows).toHaveLength(25);
      expect(res.total).toBe(26);
    });

    it('defaults to a queue of PENDING_CAP rows when no cap is given', async () => {
      const club = await mkClub();
      for (let i = 0; i < PENDING_CAP + 1; i++) {
        await mkMember(club.id, { name: `Q ${String(i).padStart(2, '0')}`, status: 'pending' });
      }

      const res = await listPendingMembers(db, { clubId: club.id });
      expect(PENDING_CAP).toBe(25);
      expect(res.rows).toHaveLength(25);
      // Counted before the cap, which is what lets the page render "+1 more" rather than
      // simply losing the 26th request.
      expect(res.total).toBe(26);
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

    /**
     * The queue's own tie-break. `joined_at` defaults to `defaultNow()`, which is
     * TRANSACTION time — so a batch of requests written in one transaction share an
     * instant exactly, and `ORDER BY joined_at` alone leaves the cap free to take a
     * different five each time it runs. The one it drops is the one nobody sees.
     *
     * Same fixture shape as the roster tie-break above, for the same reason: every row
     * carries the identical timestamp, so a version without `asc(memberships.id)` has
     * nothing left to order by.
     */
    it('orders requests that arrived in the same instant deterministically', async () => {
      const club = await mkClub();
      const joinedAt = new Date('2024-03-03T08:00:00Z');
      const made = [];
      for (let i = 0; i < 6; i++) made.push(await mkMember(club.id, { name: `Tie ${i}`, status: 'pending', joinedAt }));

      const ordered = await db.select({ id: schema.memberships.id }).from(schema.memberships)
        .where(inArray(schema.memberships.id, made.map((m) => m.membershipId)))
        .orderBy(asc(schema.memberships.id));
      const expected = ordered.map((r) => r.id);

      const first = await listPendingMembers(db, { clubId: club.id, cap: 3 });
      const all = await listPendingMembers(db, { clubId: club.id, cap: 6 });
      expect(first.rows.map((r) => r.membershipId)).toEqual(expected.slice(0, 3));
      expect(all.rows.map((r) => r.membershipId)).toEqual(expected);
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

  /*
    ── Lifting a suspension ────────────────────────────────────────────────────────────

    The product could permanently suspend a member (`noshow_penalty = 'never'`) and had
    nothing anywhere that undid it, while the member's own screen told them to contact
    the club. These tests are about the operation that closes that, and every one of them
    reaches the suspension through the REAL `markNoShow` path rather than by inserting a
    penalty row by hand — a hand-inserted row tests `liftPenalties`, not the fix.
  */
  describe('liftPenalties', () => {
    const TZ = 'Europe/Istanbul';
    /** The missed session. Tuesday, so `NEXT_WEEK` below shares its weekday. */
    const MISSED_DAY = '2026-03-10';
    const NEXT_WEEK = '2026-03-17';
    const MISSED_START = zonedWallClockToUtc(MISSED_DAY, '07:00', TZ);
    /** The evening after the missed session — every mark and every lift happens here. */
    const NOW = zonedWallClockToUtc(MISSED_DAY, '20:00', TZ);
    const NEXT_WEEK_START = zonedWallClockToUtc(NEXT_WEEK, '07:00', TZ);

    type Policy = 'off' | '2d' | '1w' | '2w' | '1m' | 'never';

    /**
     * A club with a real weekly window (so `bookSeat` has something to book), one
     * approved member, and that member seated on a session that has already started.
     */
    async function seedSeatedMember(policy: Policy) {
      const t = tag('lift');
      const [club] = await db.insert(schema.clubs)
        .values({ slug: t, name: t, status: 'active', timezone: TZ, noshowPenalty: policy }).returning();
      const [boat] = await db.insert(schema.boatTypes)
        .values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment: 'both' }).returning();
      const { weekday } = utcToClubDate(MISSED_START, TZ);
      const [win] = await db.insert(schema.scheduleWindows)
        .values({ clubId: club.id, weekday, startTime: '07:00', endTime: '08:00', defaultSessionMinutes: 60 }).returning();
      await db.insert(schema.windowBoats).values({ windowId: win.id, boatTypeId: boat.id, quantity: 1 });
      const { id: userId } = await mkUser();
      const [membership] = await db.insert(schema.memberships)
        .values({ userId, clubId: club.id, status: 'approved' }).returning();
      const seat = await seedStartedSeat({ club, boat, userId }, MISSED_DAY, '07:00');
      return { club, boat, win, userId, membership, ...seat };
    }

    /** Another session of the same club that has ALREADY started, with this member seated on it. */
    async function seedStartedSeat(
      ctx: { club: { id: string }; boat: { id: string }; userId: string },
      dateISO: string,
      hhmm: string,
    ) {
      const startAt = zonedWallClockToUtc(dateISO, hhmm, TZ);
      const [slot] = await db.insert(schema.slots)
        .values({ clubId: ctx.club.id, date: dateISO, startAt, endAt: new Date(startAt.getTime() + 3_600_000) }).returning();
      const [session] = await db.insert(schema.sessions)
        .values({ slotId: slot.id, clubId: ctx.club.id, boatTypeId: ctx.boat.id, capacity: 2 }).returning();
      const [booking] = await db.insert(schema.bookings)
        .values({ sessionId: session.id, clubId: ctx.club.id, userId: ctx.userId, paymentType: 'regular', status: 'booked', effectiveAt: startAt, bookingDate: dateISO }).returning();
      return { slot, session, booking };
    }

    /** A seat the member holds on a slot in the FUTURE — what `markNoShow`'s cascade walks. */
    async function seedFutureSeat(ctx: { club: { id: string }; boat: { id: string }; userId: string }, dateISO = NEXT_WEEK) {
      const startAt = zonedWallClockToUtc(dateISO, '07:00', TZ);
      const [slot] = await db.insert(schema.slots)
        .values({ clubId: ctx.club.id, date: dateISO, startAt, endAt: new Date(startAt.getTime() + 3_600_000) }).returning();
      const [session] = await db.insert(schema.sessions)
        .values({ slotId: slot.id, clubId: ctx.club.id, boatTypeId: ctx.boat.id, capacity: 2 }).returning();
      await db.insert(schema.bookings)
        .values({ sessionId: session.id, clubId: ctx.club.id, userId: ctx.userId, paymentType: 'regular', status: 'booked', effectiveAt: NOW, bookingDate: NEXT_WEEK });
      return { slot, session };
    }

    const membershipRow = async (id: string) =>
      (await db.select().from(schema.memberships).where(eq(schema.memberships.id, id)))[0];

    const penaltyRows = async (membershipId: string) =>
      db.select().from(schema.penalties)
        .where(eq(schema.penalties.membershipId, membershipId))
        .orderBy(asc(schema.penalties.createdAt), asc(schema.penalties.id));

    /**
     * THE invariant this whole slice has to preserve, and the only honest assertion for a
     * race: the membership's persisted ban must be exactly what `resolveBan` folds from
     * the penalty rows that are still live. Either outcome of a race is acceptable — what
     * is not acceptable is a lifted ban sitting next to an un-lifted penalty nobody
     * notices, or a lift silently undone, and both of those are a mismatch here.
     */
    async function expectBanMatchesLivePenalties(membershipId: string) {
      const m = await membershipRow(membershipId);
      const live = (await penaltyRows(membershipId)).filter((p) => p.liftedAt === null);
      const expected = resolveBan(live);
      expect({ status: m.status, bannedUntil: m.bannedUntil?.toISOString() ?? null }).toEqual({
        status: expected.permanent ? 'banned' : 'approved',
        bannedUntil: expected.bannedUntil?.toISOString() ?? null,
      });
      return { membership: m, live };
    }

    /**
     * The premise the whole design rests on, asserted rather than assumed: re-approving
     * the membership is NOT the escape hatch. The permanent penalty row survives, so the
     * very next `recomputeBan` folds it back in and the member is banned again.
     *
     * The second absence is marked under the `off` policy on purpose — that row imposes
     * no ban of its own, so the re-ban can only have come from the surviving permanent
     * row. Under any other policy the test would pass for the wrong reason.
     */
    it('is needed because re-approving the membership does not survive the next recompute', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
      expect((await membershipRow(ctx.membership.id)).status).toBe('banned');

      expect(await setMembershipStatus(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, status: 'approved', actorId: owner.id })).toBe(true);
      expect((await membershipRow(ctx.membership.id)).status).toBe('approved');

      await db.update(schema.clubs).set({ noshowPenalty: 'off' }).where(eq(schema.clubs.id, ctx.club.id));
      const second = await seedStartedSeat(ctx, MISSED_DAY, '09:00');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);

      // Back to banned, off a penalty row nobody ever removed.
      expect((await membershipRow(ctx.membership.id)).status).toBe('banned');
    });

    it('restores a permanently suspended member end to end, down to being able to book again', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');

      const marked = await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW });
      expect(marked).toMatchObject({ ok: true, permanent: true });

      const suspended = await membershipRow(ctx.membership.id);
      expect(suspended.status).toBe('banned');
      expect(restrictionState(suspended, NOW)).toBe('suspended');
      expect(await getRestriction(db, suspended, NOW)).toMatchObject({ state: 'suspended' });
      // The member's own door, closed: this is the state the copy tells them to contact
      // the club about.
      expect(await bookSeat(db, {
        clubId: ctx.club.id, userId: ctx.userId, windowId: ctx.win.id, boatTypeId: ctx.boat.id,
        startAt: NEXT_WEEK_START, paymentType: 'regular', idempotencyKey: randomUUID(), now: NOW,
      })).toEqual({ ok: false, error: 'ineligible', reason: 'banned' });

      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW })).toBe(true);

      const after = await membershipRow(ctx.membership.id);
      expect(after.status).toBe('approved');
      expect(after.bannedUntil).toBeNull();
      expect(restrictionState(after, NOW)).toBe('none');
      expect(await getRestriction(db, after, NOW)).toEqual({ state: 'none' });
      // The whole point. Anything short of this tests the function rather than the fix.
      expect(await bookSeat(db, {
        clubId: ctx.club.id, userId: ctx.userId, windowId: ctx.win.id, boatTypeId: ctx.boat.id,
        startAt: NEXT_WEEK_START, paymentType: 'regular', idempotencyKey: randomUUID(), now: NOW,
      })).toMatchObject({ ok: true, outcome: 'seated' });
    });

    /**
     * The mixed history the predicate exists for: a timed penalty that lapsed months ago
     * and a permanent one issued today.
     *
     * Only the permanent row is IN FORCE, so only it is stamped. Stamping the lapsed row
     * as well would record that an owner reversed a penalty that had already expired on
     * its own — a false entry in the very audit trail this design keeps rows for. Leaving
     * it unlifted costs nothing: `resolveBan` still folds it, and it folds to a date in
     * the past, which `restrictionState` reads as no restriction at all.
     */
    it('lifts only the penalties in force, and leaves a lapsed one alone', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('2d');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
      const lapsedEndsAt = (await membershipRow(ctx.membership.id)).bannedUntil;
      expect(lapsedEndsAt).not.toBeNull();

      // Four months on, the club has switched to the permanent policy and the member
      // misses another session. The March ban lapsed long ago.
      const JULY = '2026-07-14';
      const JULY_EVENING = zonedWallClockToUtc(JULY, '20:00', TZ);
      await db.update(schema.clubs).set({ noshowPenalty: 'never' }).where(eq(schema.clubs.id, ctx.club.id));
      const july = await seedStartedSeat(ctx, JULY, '07:00');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: july.booking.id, actorId: owner.id, now: JULY_EVENING })).ok).toBe(true);
      expect(restrictionState(await membershipRow(ctx.membership.id), JULY_EVENING)).toBe('suspended');

      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: JULY_EVENING })).toBe(true);

      const rows = await penaltyRows(ctx.membership.id);
      expect(rows).toHaveLength(2);
      const [march, julyRow] = rows;
      expect(march.permanent).toBe(false);
      expect(march.liftedAt).toBeNull();
      expect(julyRow.permanent).toBe(true);
      expect(julyRow.liftedAt).not.toBeNull();

      const after = await membershipRow(ctx.membership.id);
      expect(after.status).toBe('approved');
      // NOT null: the lapsed March row is still live and `resolveBan` still folds it.
      expect(after.bannedUntil?.toISOString()).toBe(lapsedEndsAt!.toISOString());
      expect(restrictionState(after, JULY_EVENING)).toBe('none');
    });

    /**
     * The reason rows are stamped rather than deleted. An owner reversing a suspension is
     * exactly the decision they will later be asked to account for, and a DELETE erases
     * both halves of that: what the member did, and that anyone undid it.
     */
    it('keeps the lifted penalty in the table, intact, and attributable to the owner who lifted it', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
      const [before] = await penaltyRows(ctx.membership.id);

      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW })).toBe(true);

      const [after] = await penaltyRows(ctx.membership.id);
      expect(after).toMatchObject({
        id: before.id, membershipId: before.membershipId, sessionId: before.sessionId,
        bookingId: before.bookingId, reason: 'no_show', permanent: true,
      });
      expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());
      expect(after.liftedAt?.toISOString()).toBe(NOW.toISOString());

      const audit = await db.select().from(schema.auditLog)
        .where(eq(schema.auditLog.target, ctx.membership.id));
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'member.penalty_lift', actorUserId: owner.id, clubId: ctx.club.id, actingAsRole: 'owner',
      });
      // The absence itself is still on the log too — one row explains the suspension,
      // the other explains the reversal, and together they are the account.
      const noshow = await db.select().from(schema.auditLog)
        .where(eq(schema.auditLog.target, ctx.booking.id));
      expect(noshow.map((a) => a.action)).toEqual(['attendance.noshow']);
    });

    it('writes no audit row and changes nothing when there is nothing in force to lift', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW })).toBe(true);
      const first = await penaltyRows(ctx.membership.id);

      // The stale-page second click. `true`, because the state asked for is the state
      // that holds — but no second audit row naming a second actor for one act, and no
      // re-stamping of `lifted_at`, which would relabel who reversed the decision and when.
      const second = await mkUser();
      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: second.id, now: new Date(NOW.getTime() + 60_000) })).toBe(true);

      const rows = await penaltyRows(ctx.membership.id);
      expect(rows.map((p) => p.liftedAt?.toISOString())).toEqual(first.map((p) => p.liftedAt?.toISOString()));
      const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.membership.id));
      expect(audit).toHaveLength(1);
      expect(audit[0].actorUserId).toBe(owner.id);
    });

    it('refuses a membership that belongs to another club, and lifts nothing', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');
      const [other] = await db.insert(schema.clubs).values({ slug: tag('c'), name: 'C', status: 'active' }).returning();
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);

      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: other.id, actorId: owner.id, now: NOW })).toBe(false);
      expect((await membershipRow(ctx.membership.id)).status).toBe('banned');
      expect((await penaltyRows(ctx.membership.id)).every((p) => p.liftedAt === null)).toBe(true);
      expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.membership.id))).toHaveLength(0);
    });

    /** A lift is a reversal of what happened, not an amnesty for what happens next. */
    it('does not immunise the member: the next absence suspends them again', async () => {
      const owner = await mkUser();
      const ctx = await seedSeatedMember('never');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
      expect(await liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW })).toBe(true);
      expect((await membershipRow(ctx.membership.id)).status).toBe('approved');

      const second = await seedStartedSeat(ctx, MISSED_DAY, '09:00');
      expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);

      const after = await membershipRow(ctx.membership.id);
      expect(after.status).toBe('banned');
      expect(restrictionState(after, NOW)).toBe('suspended');
      const live = (await penaltyRows(ctx.membership.id)).filter((p) => p.liftedAt === null);
      expect(live).toHaveLength(1);
      expect(live[0].bookingId).toBe(second.booking.id);
    });

    /**
     * ── The race, driven deterministically ──────────────────────────────────────────
     *
     * Both directions of `liftPenalties` × `markNoShow`, each blocked at a precise point
     * with a lock held from a connection of this test's own, so the interleaving is not
     * left to a `Promise.all` and a warm pool to produce by luck.
     *
     * The lever is `markNoShow`'s CASCADE lock. It takes a per-slot advisory lock for
     * every FUTURE seat it cancels, and it takes those AFTER it has written its penalty
     * row and recomputed the ban. Holding one of those locks parks the real `markNoShow`
     * mid-transaction with its work done and uncommitted — which is exactly the window a
     * concurrent lift must not be able to step through.
     */
    describe('against a concurrent markNoShow', () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      /**
       * Take `lock` on a connection of this test's own, run `body` under it, then release
       * it and hand back whatever `body` returned — which is how the two tests below get
       * their in-flight promises out and await them AFTER the lock is gone.
       *
       * The `finally` is not decoration. A failed assertion inside `body` would otherwise
       * leave the connection checked out with an open transaction, and `afterAll`'s
       * `pool.end()` then hangs until vitest's hook timeout — reporting a timeout in
       * `beforeAll`/`afterAll` instead of the assertion that actually failed. Seen, while
       * these very tests were red.
       */
      async function whileHolding<T>(lock: { text: string; values: unknown[] }, body: () => Promise<T>): Promise<T> {
        const holder = await pool.connect();
        try {
          await holder.query('BEGIN');
          await holder.query(lock.text, lock.values);
          return await body();
        } finally {
          await holder.query('ROLLBACK').catch(() => {});
          holder.release();
        }
      }

      it('a lift arriving mid-mark does not leave a lifted ban next to a live penalty', async () => {
        const owner = await mkUser();
        const ctx = await seedSeatedMember('never');
        // A first suspension, so the lift has something in force to find even before the
        // concurrent mark lands.
        expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
        const future = await seedFutureSeat(ctx);
        const second = await seedStartedSeat(ctx, MISSED_DAY, '09:00');

        // Park the cascade: `markNoShow` reaches this slot's lock only AFTER it has
        // inserted its penalty row and written the recomputed ban, so holding it leaves
        // the real `markNoShow` mid-transaction with its work done and uncommitted.
        const { marking, lifting } = await whileHolding(
          { text: 'select pg_advisory_xact_lock(hashtext($1), hashtext($2))', values: [ctx.club.id, future.slot.startAt.toISOString()] },
          async () => {
            const marking = markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, actorId: owner.id, now: NOW });
            await sleep(500);
            const lifting = liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW });
            await sleep(500);
            return { marking, lifting };
          },
        );

        expect((await marking).ok).toBe(true);
        expect(await lifting).toBe(true);

        const { membership, live } = await expectBanMatchesLivePenalties(ctx.membership.id);
        // The lift is serialized AFTER the mark, so it sees the fresh penalty and lifts
        // it too. Without that, the membership reads 'approved' while a permanent penalty
        // row sits under it un-lifted, waiting for the next recompute to re-ban.
        expect(membership.status).toBe('approved');
        expect(live).toHaveLength(0);
        expect(await penaltyRows(ctx.membership.id)).toHaveLength(2);
      }, 20_000);

      it('a mark arriving mid-lift does not silently undo the lift', async () => {
        const owner = await mkUser();
        const ctx = await seedSeatedMember('never');
        expect((await markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW })).ok).toBe(true);
        const second = await seedStartedSeat(ctx, MISSED_DAY, '09:00');
        // The second absence falls under a TIMED policy, so if the lift is undone the
        // membership ends up 'banned' with no permanent row under it at all — a state
        // `resolveBan` disagrees with, which is what the invariant check catches.
        await db.update(schema.clubs).set({ noshowPenalty: '2d' }).where(eq(schema.clubs.id, ctx.club.id));

        // Park both operations on the membership row itself, the lift queued first.
        const { marking, lifting } = await whileHolding(
          { text: 'select id from memberships where id = $1 for update', values: [ctx.membership.id] },
          async () => {
            const lifting = liftPenalties(db, { membershipId: ctx.membership.id, clubId: ctx.club.id, actorId: owner.id, now: NOW });
            await sleep(500);
            const marking = markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, actorId: owner.id, now: NOW });
            await sleep(500);
            return { marking, lifting };
          },
        );

        expect(await lifting).toBe(true);
        expect((await marking).ok).toBe(true);

        await expectBanMatchesLivePenalties(ctx.membership.id);
      }, 20_000);

      /**
       * The test that actually earns `markNoShow`'s own `FOR UPDATE`, and it is not the
       * one above.
       *
       * Measured: with the lock removed from `markNoShow` and left in place on
       * `liftPenalties`, both tests above still pass — because inserting a `penalties`
       * row takes a FOR KEY SHARE lock on the referenced `memberships` row for the
       * foreign key, and that already conflicts with the lift's FOR UPDATE. The lift's
       * lock alone serializes lift-against-mark in both directions. Claiming those two
       * tests as evidence for the lock on `markNoShow` would have been claiming a
       * property of the foreign key.
       *
       * What the foreign key does NOT cover is mark against mark. `UPDATE memberships
       * SET status/banned_until` touches no key column, so it takes FOR NO KEY UPDATE,
       * which is compatible with FOR KEY SHARE — two concurrent `markNoShow`s on one
       * member walk straight past each other, each folding a penalty set the other has
       * already added to. The one that writes last wins with an answer computed from a
       * state that no longer exists.
       *
       * Reachable in ordinary use: an owner working down a roster marking absences, or
       * two owners doing it at once. And it is `recomputeBan`'s stated invariant, so
       * leaving one of its three callers outside the lock would make that comment a lie
       * the moment anyone relied on it.
       */
      it('two absences on one member, marked at once, agree with the rows they wrote', async () => {
        const owner = await mkUser();
        const ctx = await seedSeatedMember('2d');
        // Inside a two-day ban, so the FIRST mark's cascade walks it — which is the point
        // where holding its lock parks that transaction with its ban already written.
        const tomorrow = await seedFutureSeat(ctx, '2026-03-11');
        const second = await seedStartedSeat(ctx, MISSED_DAY, '09:00');

        const { timed, permanent } = await whileHolding(
          { text: 'select pg_advisory_xact_lock(hashtext($1), hashtext($2))', values: [ctx.club.id, tomorrow.slot.startAt.toISOString()] },
          async () => {
            const timed = markNoShow(db, { clubId: ctx.club.id, bookingId: ctx.booking.id, actorId: owner.id, now: NOW });
            await sleep(500);
            // The club tightens its policy between the two marks, so the second absence
            // is permanent and the two rows fold to different things. Same club, so this
            // is also the only way to get two penalty shapes onto one membership.
            await db.update(schema.clubs).set({ noshowPenalty: 'never' }).where(eq(schema.clubs.id, ctx.club.id));
            const permanent = markNoShow(db, { clubId: ctx.club.id, bookingId: second.booking.id, actorId: owner.id, now: NOW });
            await sleep(500);
            return { timed, permanent };
          },
        );

        expect((await timed).ok).toBe(true);
        expect((await permanent).ok).toBe(true);

        // Unlocked, the permanent mark commits `banned_until = NULL` over the timed
        // mark's date, leaving the membership claiming no end date while a live timed
        // penalty row still names one.
        await expectBanMatchesLivePenalties(ctx.membership.id);
      }, 20_000);
    });
  });
});
