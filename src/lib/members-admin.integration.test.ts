import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { assignSkillLevel, setMembershipStatus } from './members-admin';

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
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'approved', actorId: uid })).toBe(false);
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c1.id, status: 'approved', actorId: uid })).toBe(true);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('approved');
  });

  it('rejects a membershipId belonging to a different club without changing it', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1b-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2b-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'pending' }).returning();
    expect(await setMembershipStatus(db, { membershipId: m.id, clubId: c2.id, status: 'rejected', actorId: uid })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.status).toBe('pending');
  });

  it('assigns a skill level from the same club and rejects one from another club', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1s-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2s-${Date.now()}`, name: 'C2', status: 'active' }).returning();
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
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1m-${Date.now()}`, name: 'C1', status: 'active' }).returning();
    const [c2] = await db.insert(schema.clubs).values({ slug: `c2m-${Date.now()}`, name: 'C2', status: 'active' }).returning();
    const [m] = await db.insert(schema.memberships).values({ userId: uid, clubId: c1.id, role: 'member', status: 'approved' }).returning();
    const [lvl] = await db.insert(schema.skillLevels).values({ clubId: c1.id, name: 'Beginner', rank: 1 }).returning();

    expect(await assignSkillLevel(db, { membershipId: m.id, clubId: c2.id, skillLevelId: lvl.id, actorId: uid })).toBe(false);
    const [after] = await db.select().from(schema.memberships).where(eq(schema.memberships.id, m.id));
    expect(after.skillLevelId).toBeNull();
  });

  it('does not assign a skill level to a non-approved membership', async () => {
    const uid = `u-${Date.now()}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    const [c1] = await db.insert(schema.clubs).values({ slug: `c1p-${Date.now()}`, name: 'C1', status: 'active' }).returning();
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
});
