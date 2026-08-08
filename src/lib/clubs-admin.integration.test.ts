import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { createClub, decideClubRequest, setClubStatus } from './clubs-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('clubs-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function mkUser() {
    const id = `u-${Date.now()}-${Math.floor(performance.now())}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co` });
    return { id, email: `${id}@t.co` };
  }

  it('creates an active club, an approved owner membership, and an audit row', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const slug = `bogazici-${Date.now()}`;
    const res = await createClub(db, { name: 'Boğaziçi Kürek', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [club] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, res.clubId));
    expect(club.status).toBe('active');
    const [m] = await db.select().from(schema.memberships)
      .where(and(eq(schema.memberships.clubId, res.clubId), eq(schema.memberships.userId, owner.id)));
    expect(m.role).toBe('owner');
    expect(m.status).toBe('approved');
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, res.clubId));
    expect(audit.length).toBeGreaterThan(0);
    // The audit row must be written with the caller's own transaction (no `as unknown as
    // DB` cast) and attributed to the admin who acted.
    expect(audit.find((a) => a.action === 'club.create')).toMatchObject({ actingAsRole: 'admin' });
  });

  it('lets an admin create a club on a slug that a rejected club still holds', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const slug = `freed-${Date.now()}-${Math.floor(performance.now())}`;
    // The partial index `clubs_slug_uq` frees a rejected slug in the database; the
    // application's `slug_taken` pre-check must agree, or the slug is dead in practice.
    await db.insert(schema.clubs).values({ slug, name: 'Spam', status: 'rejected' });
    expect(await createClub(db, { name: 'Real', slug, ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: true });
  });

  it('rejects reserved and duplicate slugs, and a missing owner', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    expect((await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id })).ok).toBe(false);
    expect(await createClub(db, { name: 'A', slug: 'admin', ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_reserved' });
    expect(await createClub(db, { name: 'A', slug: `x-${Date.now()}`, ownerEmail: 'nobody@nowhere.co', createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'owner_not_found' });
    const slug = `dup-${Date.now()}`;
    await createClub(db, { name: 'A', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(await createClub(db, { name: 'B', slug, ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_taken' });
  });

  it('approves a pending club: status active, review stamped, club.approve audited', async () => {
    const admin = await mkUser();
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ap-${Date.now()}`, name: 'Ap', status: 'pending', createdBy: requester.id }).returning();

    const res = await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id });
    expect(res).toMatchObject({ ok: true, status: 'active', requesterId: requester.id, clubName: 'Ap' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('active');
    expect(after.reviewedBy).toBe(admin.id);
    expect(after.reviewedAt).not.toBeNull();

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action)).toContain('club.approve');
    expect(audit.find((a) => a.action === 'club.approve')?.actingAsRole).toBe('admin');
  });

  it('rejects a pending club and stores the note', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `rj-${Date.now()}`, name: 'Rj', status: 'pending' }).returning();

    const res = await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: '  Duplicate of an existing club  ', actorId: admin.id });
    expect(res).toMatchObject({ ok: true, status: 'rejected' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('rejected');
    expect(after.reviewNote).toBe('Duplicate of an existing club');

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action)).toContain('club.reject');
  });

  // `review_note` cannot be enforced by the schema — the column is nullable because an
  // approval has no note. This check is the ONLY thing standing between a requester and
  // a rejection email that says nothing.
  it('refuses to reject without a note, and does not touch the row', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `nn-${Date.now()}`, name: 'Nn', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: '   ', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });
    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('pending');
    expect(after.reviewedAt).toBeNull();
  });

  it('refuses to decide a club that is not pending', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `np-${Date.now()}`, name: 'Np', status: 'active' }).returning();
    expect(await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_pending' });
  });

  // The un-reject hole: `setClubStatus` is id-keyed, so without a status precondition it
  // would happily walk a rejected club back to `active` — and collide with whatever live
  // club has since claimed that slug.
  it('setClubStatus refuses a pending club and refuses a rejected club', async () => {
    const admin = await mkUser();
    const [pendingClub] = await db.insert(schema.clubs)
      .values({ slug: `sp-${Date.now()}`, name: 'Sp', status: 'pending' }).returning();
    expect(await setClubStatus(db, { clubId: pendingClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
    const [stillPending] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, pendingClub.id));
    expect(stillPending.status).toBe('pending');

    const [rejectedClub] = await db.insert(schema.clubs)
      .values({ slug: `sr-${Date.now()}`, name: 'Sr', status: 'rejected' }).returning();
    expect(await setClubStatus(db, { clubId: rejectedClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
    const [stillRejected] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, rejectedClub.id));
    expect(stillRejected.status).toBe('rejected');
  });

  it('setClubStatus suspends and reinstates an active club, auditing each way', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ss-${Date.now()}`, name: 'Ss', status: 'active' }).returning();

    expect(await setClubStatus(db, { clubId: club.id, status: 'suspended', actorId: admin.id })).toMatchObject({ ok: true });
    const [suspended] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(suspended.status).toBe('suspended');

    expect(await setClubStatus(db, { clubId: club.id, status: 'active', actorId: admin.id })).toMatchObject({ ok: true });
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['club.activate', 'club.suspend']);
  });

  it('reports not_found for an unknown club id', async () => {
    const admin = await mkUser();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect(await decideClubRequest(db, { clubId: missing, decision: 'approve', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_found' });
    expect(await setClubStatus(db, { clubId: missing, status: 'suspended', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_found' });
  });
});
