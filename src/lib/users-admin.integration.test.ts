import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { searchUsers, setPlatformAdmin } from './users-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('users-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  // Ids come from `randomUUID`, never a sentinel: a fixed id survives a failed run as an
  // orphan row and then makes the next run pass in isolation and fail in the full suite.
  async function mkUser(opts: { name?: string; isAdmin?: boolean } = {}) {
    const id = `ua-${randomUUID()}`;
    await db.insert(schema.user).values({
      id,
      name: opts.name ?? 'User',
      email: `${id}@t.co`,
      isAdmin: opts.isAdmin ?? false,
    });
    return { id, email: `${id}@t.co` };
  }

  it('finds a user by a case-insensitive fragment of email or name, with their memberships', async () => {
    const stamp = randomUUID().slice(0, 8);
    const u = await mkUser({ name: `Zeynep ${stamp}` });
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `u-${stamp}`, name: 'Search Club', status: 'active' }).returning();
    await db.insert(schema.memberships)
      .values({ userId: u.id, clubId: club.id, role: 'owner', status: 'approved' });

    const byName = await searchUsers(db, { q: `zeynep ${stamp}`.toUpperCase() });
    expect(byName.rows.map((r) => r.id)).toContain(u.id);
    const hit = byName.rows.find((r) => r.id === u.id);
    expect(hit?.memberships).toEqual([
      { clubId: club.id, clubName: 'Search Club', role: 'owner', status: 'approved' },
    ]);

    const byEmail = await searchUsers(db, { q: u.email.slice(0, 12).toUpperCase() });
    expect(byEmail.rows.map((r) => r.id)).toContain(u.id);
  });

  // An unescaped `_` is a single-character wildcard, so a search for `a_b` would return
  // `axb` — the same silent over-match Task 6 had to fix in the audit filter.
  it('treats LIKE metacharacters in the query as literal text', async () => {
    const stamp = randomUUID().slice(0, 8);
    const literal = await mkUser({ name: `lit_${stamp}` });
    await mkUser({ name: `litX${stamp}` });

    const res = await searchUsers(db, { q: `lit_${stamp}` });
    expect(res.rows.map((r) => r.id)).toEqual([literal.id]);
    expect(res.total).toBe(1);
  });

  it('paginates and reports a total larger than the page', async () => {
    const stamp = `pg${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 3; i++) await mkUser({ name: `${stamp}-${i}` });
    const first = await searchUsers(db, { q: stamp, page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await searchUsers(db, { q: stamp, page: 2, pageSize: 2 });
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(3);
  });

  // A page number travels in a hand-editable URL and lands in `OFFSET (page - 1) * n`,
  // which Postgres parses as `bigint`. Each of these raised out of the render as a 500
  // before the clamp: `?page=1.5` -> `invalid input syntax for type bigint: "12.5"`.
  it.each([
    ['a fraction', 1.5],
    ['a fraction on a later page', 2.7],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
    ['a huge float', 1e20],
    ['a negative page', -3],
    ['zero', 0],
  ] as const)('answers a query asking for %s of a page instead of raising from Postgres', async (_label, page) => {
    const stamp = `cl${randomUUID().slice(0, 8)}`;
    await mkUser({ name: `${stamp}-a` });

    const res = await searchUsers(db, { q: stamp, page, pageSize: 2 });
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(Number.isSafeInteger(res.page)).toBe(true);
    expect(res.page).toBe(1);
  });

  // Asking for page 999 of a two-page list shows page 2. The rows, the reported page and
  // the range the route renders from it then describe the same page — instead of the
  // empty state above "24951-100 of 100" with a Previous link into another empty page.
  it('clamps a page past the end to the last page that has rows', async () => {
    const stamp = `ov${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 3; i++) await mkUser({ name: `${stamp}-${i}` });

    const res = await searchUsers(db, { q: stamp, page: 999, pageSize: 2 });
    expect(res.page).toBe(2);
    expect(res.total).toBe(3);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].name).toBe(`${stamp}-2`);
  });

  // No unbounded select: an empty query must still be capped, or `/admin/users` becomes
  // the same "select everything" the clubs list was.
  it('caps an empty query at the page size', async () => {
    for (let i = 0; i < 3; i++) await mkUser();
    const res = await searchUsers(db, { pageSize: 2 });
    expect(res.rows.length).toBeLessThanOrEqual(2);
    expect(res.total).toBeGreaterThan(2);
  });

  it('grants admin and audits user.admin_grant', async () => {
    const actor = await mkUser({ isAdmin: true });
    const target = await mkUser();
    expect(await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }))
      .toMatchObject({ ok: true, isAdmin: true });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, target.id));
    expect(rows.map((a) => a.action)).toContain('user.admin_grant');
    expect(rows[0].actingAsRole).toBe('admin');
    // Platform admin is not scoped to a club, and inventing one would be a lie in the log.
    expect(rows[0].clubId).toBeNull();
  });

  // Two operators on `/admin/users`: one grants, the other's page still shows "Make
  // admin" and they click it. The second click must not add a second grant to the log —
  // one row per thing that happened, or the log stops being a record of events.
  it('does not write a second audit row for a grant that changes nothing', async () => {
    const actor = await mkUser({ isAdmin: true });
    const target = await mkUser();

    expect(await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }))
      .toMatchObject({ ok: true, isAdmin: true });
    expect(await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }))
      .toMatchObject({ ok: true, isAdmin: true });

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, target.id));
    expect(rows.map((a) => a.action)).toEqual(['user.admin_grant']);
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(true);
  });

  // The defect this cycle exists to prevent: a `user.admin_revoke` row claiming a revoke
  // that did not happen, reachable from a stale page or a crafted POST.
  it('writes no audit row when revoking someone who is not an admin', async () => {
    const actor = await mkUser({ isAdmin: true });
    await mkUser({ isAdmin: true }); // so `last_admin` is not what refuses this
    const target = await mkUser({ isAdmin: false });

    expect(await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: false, actorId: actor.id }))
      .toMatchObject({ ok: true, isAdmin: false });

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, target.id));
    expect(rows).toHaveLength(0);
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(false);
  });

  // Revoking a non-admin was refused as `last_admin`, which told the operator "this is
  // the last platform admin" about a user who is not an admin at all.
  it('does not blame the last-admin guard for a revoke of a non-admin', async () => {
    await db.update(schema.user).set({ isAdmin: false }).where(eq(schema.user.isAdmin, true));
    const onlyAdmin = await mkUser({ isAdmin: true });
    const target = await mkUser({ isAdmin: false });

    const res = await setPlatformAdmin(db, { targetUserId: target.id, isAdmin: false, actorId: onlyAdmin.id });
    expect(res).toMatchObject({ ok: true, isAdmin: false });
    // And the one real admin is untouched.
    const [admin] = await db.select().from(schema.user).where(eq(schema.user.id, onlyAdmin.id));
    expect(admin.isAdmin).toBe(true);
  });

  // The grant path takes no lock, so both transactions read `is_admin = false`. The
  // `ne(...)` in the UPDATE is what stops the loser writing a second grant row.
  it('writes one audit row when two grants of the same user race', async () => {
    const actor = await mkUser({ isAdmin: true });
    const target = await mkUser();

    // Cold-pool trap, as in the revoke race below: without warm connections the second
    // transaction spends its first milliseconds connecting and the two never overlap.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [ra, rb] = await Promise.all([
      setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }),
      setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: actor.id }),
    ]);
    expect([ra, rb].every((r) => r.ok)).toBe(true);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, target.id));
    expect(rows.map((a) => a.action)).toEqual(['user.admin_grant']);
  });

  it('reports a missing target rather than writing an audit row', async () => {
    const actor = await mkUser({ isAdmin: true });
    const ghost = `ua-${randomUUID()}`;
    expect(await setPlatformAdmin(db, { targetUserId: ghost, isAdmin: true, actorId: actor.id }))
      .toMatchObject({ ok: false, error: 'not_found' });
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, ghost));
    expect(rows).toHaveLength(0);
  });

  it('refuses a self-revoke and leaves the flag set', async () => {
    const actor = await mkUser({ isAdmin: true });
    await mkUser({ isAdmin: true }); // so last_admin is not the reason for the refusal
    expect(await setPlatformAdmin(db, { targetUserId: actor.id, isAdmin: false, actorId: actor.id }))
      .toMatchObject({ ok: false, error: 'self_revoke' });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, actor.id));
    expect(after.isAdmin).toBe(true);
  });

  it('refuses to revoke the last remaining admin', async () => {
    // Start from a known-empty admin set so the count is deterministic.
    await db.update(schema.user).set({ isAdmin: false }).where(eq(schema.user.isAdmin, true));
    const actor = await mkUser({ isAdmin: false });
    const onlyAdmin = await mkUser({ isAdmin: true });
    expect(await setPlatformAdmin(db, { targetUserId: onlyAdmin.id, isAdmin: false, actorId: actor.id }))
      .toMatchObject({ ok: false, error: 'last_admin' });
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, onlyAdmin.id));
    expect(after.isAdmin).toBe(true);
  });

  // Two operators trimming the admin list in the same second. Without `FOR UPDATE` on the
  // count, READ COMMITTED lets both transactions read "2 admins", both pass the guard, and
  // both write — leaving zero admins and nobody able to grant the flag back. Exactly one
  // revoke may win.
  it('lets only one of two concurrent revokes win, leaving one admin standing', async () => {
    await db.update(schema.user).set({ isAdmin: false }).where(eq(schema.user.isAdmin, true));
    const actor = await mkUser({ isAdmin: false });
    const a = await mkUser({ isAdmin: true });
    const b = await mkUser({ isAdmin: true });

    // Warm two pool connections FIRST. `db.transaction` calls `pool.connect()`, and on a
    // cold pool the second call spends its first milliseconds on a TCP handshake and auth —
    // by which time the first transaction has already committed, so the two never overlap
    // and the race cannot reproduce. Without this the test passes with the lock removed.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [ra, rb] = await Promise.all([
      setPlatformAdmin(db, { targetUserId: a.id, isAdmin: false, actorId: actor.id }),
      setPlatformAdmin(db, { targetUserId: b.id, isAdmin: false, actorId: actor.id }),
    ]);

    expect([ra, rb].filter((r) => r.ok)).toHaveLength(1);
    expect([ra, rb].find((r) => !r.ok)).toMatchObject({ ok: false, error: 'last_admin' });

    // The invariant the guard exists for: the platform is never left without an admin.
    const admins = await db.select().from(schema.user).where(eq(schema.user.isAdmin, true));
    expect(admins).toHaveLength(1);
    // And the refusal left no audit row claiming a revoke that did not happen.
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.actorUserId, actor.id));
    expect(audit).toHaveLength(1);
  });

  it('rolls the flag change back when the audit insert fails', async () => {
    const target = await mkUser();
    await expect(setPlatformAdmin(db, { targetUserId: target.id, isAdmin: true, actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [after] = await db.select().from(schema.user).where(eq(schema.user.id, target.id));
    expect(after.isAdmin).toBe(false);
  });
});
