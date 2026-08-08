import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { type AuditCursor, listAuditRows, logAudit } from './audit';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('listAuditRows', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  // Every id is random: this database is shared with the rest of the integration
  // suite and rows survive the run, so a fixed sentinel would make a later run
  // pass in isolation and fail in the full suite.
  async function mkUser() {
    const id = `au-${randomUUID()}`;
    await db.insert(schema.user).values({ id, name: 'Auditor', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  async function mkClub(name: string) {
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `aud-${randomUUID()}`, name, status: 'active' })
      .returning();
    return club;
  }

  it('returns newest first, resolves actor and club, and pages by keyset without repeats', async () => {
    const actor = await mkUser();
    const club = await mkClub('Audit Club');
    for (let i = 0; i < 5; i++) {
      await logAudit(db, {
        actorUserId: actor.id, clubId: club.id, action: 'boat.update', target: `t-${i}`, actingAsRole: 'owner',
      });
    }

    const first = await listAuditRows(db, { filters: { clubId: club.id }, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.rows[0].actorName).toBe('Auditor');
    expect(first.rows[0].clubName).toBe('Audit Club');
    expect(first.rows[0].createdAt.getTime()).toBeGreaterThanOrEqual(first.rows[1].createdAt.getTime());
    expect(first.nextCursor).not.toBeNull();

    const second = await listAuditRows(db, { filters: { clubId: club.id }, cursor: first.nextCursor, limit: 2 });
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    const third = await listAuditRows(db, { filters: { clubId: club.id }, cursor: second.nextCursor, limit: 2 });
    expect(third.rows).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
  });

  /**
   * The precision trap, pinned deterministically.
   *
   * `AuditCursor.createdAt` is a JS `Date`, which carries MILLISECONDS. While
   * `created_at` was declared without a precision it stored MICROSECONDS, so the
   * cursor of a row written at `…748926` came back as `…748` and
   * `(created_at, id) < ($ts, $id)` then excluded every row between `…748000` and
   * `…748926`. Those rows were unreachable forever — no duplicates, pure silent
   * loss, and invisible to a test whose rows happen to land in different
   * milliseconds.
   *
   * The fix is `precision: 3` on the column, which makes the published cursor
   * contract lossless by construction. This test writes rows at explicit
   * SUB-millisecond offsets — the exact case that used to disappear.
   */
  it('pages through rows written inside one millisecond without losing any', async () => {
    const actor = await mkUser();
    const club = await mkClub('Precision');
    // 100–400µs past the same millisecond: with `precision: 3` all four land on
    // `…049.000` and `id` is what separates them, which is what the keyset comment
    // in `listAuditRows` has always claimed.
    const written: string[] = [];
    for (const micros of ['000100', '000200', '000300', '000400']) {
      const [row] = await db.insert(schema.auditLog).values({
        actorUserId: actor.id, clubId: club.id, action: 'boat.update',
        target: `us-${micros}`, actingAsRole: 'owner',
        createdAt: sql`${`2026-08-08 20:11:49.${micros}+00`}::timestamptz`,
      }).returning();
      written.push(row.id);
    }

    const seen: string[] = [];
    let cursor: AuditCursor | null = null;
    // Bounded so a cursor that fails to advance fails the assertion instead of
    // hanging the suite.
    for (let page = 0; page < 6; page++) {
      const res: { rows: { id: string }[]; nextCursor: AuditCursor | null } =
        await listAuditRows(db, { filters: { clubId: club.id }, cursor, limit: 2 });
      seen.push(...res.rows.map((r) => r.id));
      cursor = res.nextCursor;
      if (!cursor) break;
    }

    expect(seen.slice().sort()).toEqual(written.slice().sort());
  });

  it('filters by action prefix and by actor', async () => {
    const actor = await mkUser();
    const other = await mkUser();
    const club = await mkClub('F');
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'skill_level.create', target: 's1', actingAsRole: 'owner' });
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'boat.create', target: 'b1', actingAsRole: 'owner' });
    await logAudit(db, { actorUserId: other.id, clubId: club.id, action: 'boat.update', target: 'b2', actingAsRole: 'owner' });

    const byPrefix = await listAuditRows(db, { filters: { clubId: club.id, actionPrefix: 'boat.' } });
    expect(byPrefix.rows.map((r) => r.action).sort()).toEqual(['boat.create', 'boat.update']);

    const byActor = await listAuditRows(db, { filters: { clubId: club.id, actorUserId: actor.id } });
    expect(byActor.rows.map((r) => r.action).sort()).toEqual(['boat.create', 'skill_level.create']);
  });

  // `date_override.set` carries the DATE as its target, and that repeats across
  // clubs. Anything that looks a target up must scope it to a club or it merges
  // two clubs' overrides into one history.
  it('keeps two clubs\' identical targets apart when scoped by club', async () => {
    const actor = await mkUser();
    const a = await mkClub('A');
    const b = await mkClub('B');
    const day = '2026-08-08';
    await logAudit(db, { actorUserId: actor.id, clubId: a.id, action: 'date_override.set', target: day, actingAsRole: 'owner' });
    await logAudit(db, { actorUserId: actor.id, clubId: b.id, action: 'date_override.clear', target: day, actingAsRole: 'owner' });

    const forA = await listAuditRows(db, { filters: { clubId: a.id, actionPrefix: 'date_override.' } });
    expect(forA.rows.map((r) => r.action)).toEqual(['date_override.set']);
    expect(forA.rows.every((r) => r.clubId === a.id)).toBe(true);
  });

  // An action prefix is operator-typed free text, so `_` and `%` must match
  // themselves. `_` is the one that matters in practice: a third of the vocabulary
  // contains one (`skill_level.`, `date_override.`), so an unescaped prefix
  // silently widens into a wildcard the operator never typed.
  it('treats LIKE metacharacters in the action prefix literally', async () => {
    const actor = await mkUser();
    const club = await mkClub('L');
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'skill_level.create', target: 's1', actingAsRole: 'owner' });
    // Written straight to the table rather than through `logAudit`: the decoy is
    // deliberately NOT a member of `AuditAction`, which is exactly the point — it
    // is the row an unescaped `_` would wrongly drag into a `skill_level.` filter.
    await db.insert(schema.auditLog).values({
      actorUserId: actor.id, clubId: club.id, action: 'skillXlevel.create', target: 'decoy', actingAsRole: 'owner',
    });

    const underscore = await listAuditRows(db, { filters: { clubId: club.id, actionPrefix: 'skill_level.' } });
    expect(underscore.rows.map((r) => r.action)).toEqual(['skill_level.create']);

    const percent = await listAuditRows(db, { filters: { clubId: club.id, actionPrefix: 'skill%' } });
    expect(percent.rows).toHaveLength(0);
  });

  it('returns a row whose actor and club have both been deleted', async () => {
    const actor = await mkUser();
    const club = await mkClub('Gone');
    await logAudit(db, { actorUserId: actor.id, clubId: club.id, action: 'club.suspend', target: club.id, actingAsRole: 'admin' });

    await db.delete(schema.clubs).where(eq(schema.clubs.id, club.id));
    await db.delete(schema.user).where(eq(schema.user.id, actor.id));

    const { rows } = await listAuditRows(db, { filters: { actionPrefix: 'club.suspend' }, limit: 50 });
    const orphan = rows.find((r) => r.target === club.id);
    expect(orphan).toBeDefined();
    expect(orphan?.actorUserId).toBeNull();
    expect(orphan?.clubId).toBeNull();
    expect(orphan?.actorName).toBeNull();
  });
});
