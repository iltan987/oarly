import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import {
  createClub, decideClubRequest, getClubAdminDetail, listClubsForAdmin, listPendingClubRequests,
  setClubStatus, TRANSFER_CANDIDATE_LIMIT, transferOwnership,
} from './clubs-admin';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('clubs-admin', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  // `randomUUID`, not a timestamp. `Date.now()` plus a floored `performance.now()` CAN
  // repeat inside one millisecond, which would be a primary-key error in an unrelated
  // assertion's setup — the transfer tests below create three or four users back to
  // back. This is a LATENT flake, not an observed one: reverting to the timestamp id
  // still passes, because each `mkUser` awaits a round trip and consecutive calls
  // rarely land in the same millisecond. The change removes the possibility and masks
  // nothing.
  async function mkUser(name = 'X') {
    const id = `u-${randomUUID()}`;
    await db.insert(schema.user).values({ id, name, email: `${id}@t.co` });
    return { id, name, email: `${id}@t.co` };
  }

  async function mkClub(prefix: string) {
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `${prefix}-${randomUUID()}`, name: prefix, status: 'active' }).returning();
    return club;
  }

  /**
   * For slugs that go through `createClub`, which enforces `validateSlug`'s 40-character
   * cap — a full 36-char UUID only fits behind the very shortest prefixes, and a fixture
   * that grew a longer prefix would start failing as `slug_invalid` for a reason that has
   * nothing to do with the assertion. Half a UUID is still 64 bits.
   */
  const slugId = () => randomUUID().slice(0, 18);

  /**
   * The queue is oldest-first, and a fixture inserted moments ago is therefore at the
   * END of it. This suite shares a database it keeps appending pending rows to, so a
   * freshly created request is reliably on the last page and nowhere else.
   */
  async function lastQueuePage(pageSize = 100) {
    const { total } = await listPendingClubRequests(db, { pageSize });
    return listPendingClubRequests(db, { page: Math.max(1, Math.ceil(total / pageSize)), pageSize });
  }

  async function ownerIdsOf(clubId: string) {
    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, clubId));
    return rows.filter((m) => m.role === 'owner').map((m) => m.userId);
  }

  it('creates an active club, an approved owner membership, and an audit row', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const slug = `bogazici-${slugId()}`;
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
    const slug = `freed-${slugId()}`;
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
    expect(await createClub(db, { name: 'A', slug: `x-${slugId()}`, ownerEmail: 'nobody@nowhere.co', createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'owner_not_found' });
    const slug = `dup-${slugId()}`;
    await createClub(db, { name: 'A', slug, ownerEmail: owner.email, createdBy: admin.id });
    expect(await createClub(db, { name: 'B', slug, ownerEmail: owner.email, createdBy: admin.id }))
      .toMatchObject({ ok: false, error: 'slug_taken' });
  });

  it('approves a pending club: status active, review stamped, club.approve audited', async () => {
    const admin = await mkUser();
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ap-${randomUUID()}`, name: 'Ap', status: 'pending', createdBy: requester.id }).returning();

    const res = await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id });
    // `clubSlug` is asserted because Task 3's decision email builds the club's URL from
    // it: a wrong-but-present value sends the requester to someone else's club.
    expect(res).toMatchObject({
      ok: true, status: 'active', requesterId: requester.id, clubName: 'Ap', clubSlug: club.slug,
    });

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
      .values({ slug: `rj-${randomUUID()}`, name: 'Rj', status: 'pending' }).returning();

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
      .values({ slug: `nn-${randomUUID()}`, name: 'Nn', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: '   ', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });
    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('pending');
    expect(after.reviewedAt).toBeNull();
  });

  // `trim()` strips ECMAScript WhiteSpace, and not every character that RENDERS as
  // blank is whitespace. `U+200B` is category `Cf` and `U+2800` is `So`, so both
  // survived a trim: a rejection note of one zero-width space was accepted, written to
  // `review_note`, logged as `club.reject`, and emailed to the requester as a rejection
  // whose reason renders blank — which defeats the only thing making an irreversible
  // act reviewable.
  it.each([
    ['zero-width space', '​'],
    ['zero-width non-joiner', '‌'],
    ['word joiner', '⁠'],
    ['braille pattern blank', '⠀'],
    ['left-to-right mark', '‎'],
    ['a mix of invisibles and whitespace', ' ​\t⠀\n '],
    ['a no-break space', ' '],
    ['tabs and newlines', '\t\n'],
  ])('refuses a rejection note that is only %s', async (_label, note) => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `zw-${randomUUID()}`, name: 'Zw', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'note_required' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('pending');
    expect(after.reviewNote).toBeNull();
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit).toEqual([]);
  });

  // The other half: the guard must not reject real prose. A note is legible if it has
  // a letter or a digit ANYWHERE, in any script — invisible characters around it are
  // stored as written rather than scrubbed, because a note in Arabic or Hebrew
  // legitimately carries `Cf` bidi marks.
  it.each([
    ['ASCII prose', 'Duplicate of an existing club'],
    ['Turkish', 'Aynı kulüp zaten kayıtlı'],
    ['a digit only', '2'],
    ['Arabic with a bidi mark', '‏نادٍ مكرر‏'],
    ['prose containing a zero-width space', 'Duplicate​club'],
  ])('accepts a rejection note that is %s', async (_label, note) => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ok-${randomUUID()}`, name: 'Ok', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'reject', note, actorId: admin.id }))
      .toMatchObject({ ok: true, status: 'rejected' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    // Stored verbatim (bar the outer trim): the operator's words are the record.
    expect(after.reviewNote).toBe(note.trim());
  });

  // An APPROVAL note is optional, so an illegible one is not a refusal — it is simply
  // no note, and must not be stored as a `review_note` that renders blank on the
  // detail page.
  it('stores an illegible approval note as no note at all', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `an-${randomUUID()}`, name: 'An', status: 'pending' }).returning();

    expect(await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: '​', actorId: admin.id }))
      .toMatchObject({ ok: true, status: 'active' });

    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.reviewNote).toBeNull();
  });

  it('refuses to decide a club that is not pending', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `np-${randomUUID()}`, name: 'Np', status: 'active' }).returning();
    expect(await decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_pending' });
  });

  // Two admins clearing the queue at once. Without `FOR UPDATE` on the SELECT, READ
  // COMMITTED lets both transactions read `pending`, both pass the guard, and both
  // write — the audit log then says the club was approved AND rejected, and the
  // requester gets both emails. Exactly one decision may win.
  it('lets only one of two concurrent decisions win', async () => {
    const admin = await mkUser();
    const other = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `rc-${randomUUID()}`, name: 'Rc', status: 'pending' }).returning();

    // Warm two pool connections FIRST. `db.transaction` calls `pool.connect()`, and on a
    // cold pool the second call spends its first milliseconds on a TCP handshake and
    // auth — by which time the first transaction has already committed, and the race
    // this test exists to catch cannot occur. Without this, the test passes with the
    // row lock removed.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [a, b] = await Promise.all([
      decideClubRequest(db, { clubId: club.id, decision: 'approve', note: null, actorId: admin.id }),
      decideClubRequest(db, { clubId: club.id, decision: 'reject', note: 'Duplicate', actorId: other.id }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    expect(winners).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, error: 'not_pending' });

    // One decision, one audit row, and the row must agree with the audit row — a
    // status that contradicts the audit trail is the failure this lock prevents.
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit).toHaveLength(1);
    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe(audit[0].action === 'club.approve' ? 'active' : 'rejected');
    expect(after.reviewNote).toBe(audit[0].action === 'club.approve' ? null : 'Duplicate');
    expect(after.reviewedBy).toBe(audit[0].actorUserId);
  });

  // The un-reject hole: `setClubStatus` is id-keyed, so without a status precondition it
  // would happily walk a rejected club back to `active` — and collide with whatever live
  // club has since claimed that slug.
  it('setClubStatus refuses a pending club and refuses a rejected club', async () => {
    const admin = await mkUser();
    const [pendingClub] = await db.insert(schema.clubs)
      .values({ slug: `sp-${randomUUID()}`, name: 'Sp', status: 'pending' }).returning();
    expect(await setClubStatus(db, { clubId: pendingClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
    const [stillPending] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, pendingClub.id));
    expect(stillPending.status).toBe('pending');

    const [rejectedClub] = await db.insert(schema.clubs)
      .values({ slug: `sr-${randomUUID()}`, name: 'Sr', status: 'rejected' }).returning();
    expect(await setClubStatus(db, { clubId: rejectedClub.id, status: 'active', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_decided' });
    const [stillRejected] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, rejectedClub.id));
    expect(stillRejected.status).toBe('rejected');
  });

  it('setClubStatus suspends and reinstates an active club, auditing each way', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `ss-${randomUUID()}`, name: 'Ss', status: 'active' }).returning();

    expect(await setClubStatus(db, { clubId: club.id, status: 'suspended', actorId: admin.id })).toMatchObject({ ok: true });
    const [suspended] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(suspended.status).toBe('suspended');

    expect(await setClubStatus(db, { clubId: club.id, status: 'active', actorId: admin.id })).toMatchObject({ ok: true });
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((a) => a.action).sort()).toEqual(['club.activate', 'club.suspend']);
  });

  it('setClubStatus writes no audit row when the club is already in that status', async () => {
    const admin = await mkUser();
    const other = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `snoop-${randomUUID()}`, name: 'Snoop', status: 'active' }).returning();

    expect(await setClubStatus(db, { clubId: club.id, status: 'suspended', actorId: admin.id })).toMatchObject({ ok: true });
    // The stale-page click: a second admin suspending a club the first already did.
    // `{ ok: true }` — the state asked for is the state that holds — but no second row.
    expect(await setClubStatus(db, { clubId: club.id, status: 'suspended', actorId: other.id })).toMatchObject({ ok: true });
    // And reinstating an already-active club is not an activation either.
    const [live] = await db.insert(schema.clubs)
      .values({ slug: `snoop2-${randomUUID()}`, name: 'Snoop2', status: 'active' }).returning();
    expect(await setClubStatus(db, { clubId: live.id, status: 'active', actorId: admin.id })).toMatchObject({ ok: true });

    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id)))
      .toHaveLength(1);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, live.id)))
      .toHaveLength(0);
  });

  /**
   * The guard checked the club's CURRENT status and never the REQUESTED one, while the
   * audit action was derived as `status === 'active' ? activate : suspend`. So a
   * `'rejected'` request wrote `rejected` — releasing the slug irreversibly — and
   * logged it as `club.suspend`. Unreachable over HTTP because `app/admin/actions.ts`
   * narrows the form value first, but the docstring claimed this defence existed.
   *
   * Cast, because the parameter type already forbids it: the point is that TypeScript
   * is gone by the time a FormData string arrives, so the runtime must refuse too.
   */
  it('setClubStatus refuses a status it is not allowed to write, instead of mislabelling it', async () => {
    const admin = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `sbad-${randomUUID()}`, name: 'Sbad', status: 'active' }).returning();

    const res = await setClubStatus(db, {
      clubId: club.id,
      status: 'rejected' as unknown as 'active' | 'suspended',
      actorId: admin.id,
    });
    expect(res).toMatchObject({ ok: false, error: 'invalid_status' });
    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, club.id));
    expect(after.status).toBe('active');
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id))).toHaveLength(0);
  });

  it('reports not_found for an unknown club id', async () => {
    const admin = await mkUser();
    const missing = '00000000-0000-0000-0000-000000000000';
    expect(await decideClubRequest(db, { clubId: missing, decision: 'approve', note: null, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_found' });
    expect(await setClubStatus(db, { clubId: missing, status: 'suspended', actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  // `memberships.role` was only ever written at INSERT time before this — no `setRole`,
  // no `transferOwner` — so a club whose owner walked away could not be reassigned by
  // anyone, including a platform admin (spec §6.3).
  it('transfers ownership, leaving exactly one owner, and audits club.transfer_owner', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const newOwner = await mkUser();
    const club = await mkClub('to');
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: newOwner.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);

    expect(await transferOwnership(db, { clubId: club.id, toUserId: newOwner.id, actorId: admin.id }))
      .toMatchObject({ ok: true, fromUserId: oldOwner.id });

    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    const owners = rows.filter((m) => m.role === 'owner');
    // Promote WITHOUT demote is the failure this asserts: two owners is a state the
    // rest of the app has never had to reason about.
    expect(owners).toHaveLength(1);
    expect(owners[0].userId).toBe(newOwner.id);
    expect(rows.find((m) => m.userId === oldOwner.id)?.role).toBe('member');
    // The demoted owner keeps their membership — a transfer is not a removal.
    expect(rows.find((m) => m.userId === oldOwner.id)?.status).toBe('approved');

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    const entry = audit.find((a) => a.action === 'club.transfer_owner');
    expect(entry?.target).toBe(newOwner.id);
    expect(entry?.actingAsRole).toBe('admin');
    expect(entry?.actorUserId).toBe(admin.id);
  });

  // A transfer, not an invitation. Promoting a stranger or a pending applicant would be
  // the deferred invitation flow (spec §7) wearing a transfer's clothes.
  it('refuses a target who is not an approved member, and leaves the owner in place', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const stranger = await mkUser();
    const pendingMember = await mkUser();
    const rejectedMember = await mkUser();
    const club = await mkClub('tn');
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: pendingMember.id, clubId: club.id, role: 'member', status: 'pending' },
      { userId: rejectedMember.id, clubId: club.id, role: 'member', status: 'rejected' },
    ]);

    for (const toUserId of [stranger.id, pendingMember.id, rejectedMember.id]) {
      expect(await transferOwnership(db, { clubId: club.id, toUserId, actorId: admin.id }))
        .toMatchObject({ ok: false, error: 'target_not_member' });
    }

    expect(await ownerIdsOf(club.id)).toEqual([oldOwner.id]);
    // A refusal writes nothing at all — an audit row for a transfer that did not
    // happen is worse than no row.
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit).toHaveLength(0);
  });

  // A membership in ANOTHER club is not a membership in this one; without the clubId
  // half of the lookup, any approved member anywhere could be handed this club.
  it('refuses a target whose only approved membership is in a different club', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const elsewhere = await mkUser();
    const club = await mkClub('tx');
    const other = await mkClub('ty');
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: elsewhere.id, clubId: other.id, role: 'member', status: 'approved' },
    ]);

    expect(await transferOwnership(db, { clubId: club.id, toUserId: elsewhere.id, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'target_not_member' });
    expect(await ownerIdsOf(club.id)).toEqual([oldOwner.id]);
  });

  it('reports already_owner rather than demoting the target it just promoted', async () => {
    const admin = await mkUser();
    const owner = await mkUser();
    const club = await mkClub('tw');
    await db.insert(schema.memberships).values({ userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' });

    expect(await transferOwnership(db, { clubId: club.id, toUserId: owner.id, actorId: admin.id }))
      .toMatchObject({ ok: false, error: 'already_owner' });
    // The demote statement matches `role = 'owner'` for the whole club, so an
    // already-owner target that fell through to it would demote itself and leave the
    // club with NO owner at all.
    expect(await ownerIdsOf(club.id)).toEqual([owner.id]);
  });

  it('reports club_not_found for an unknown club id', async () => {
    const admin = await mkUser();
    const target = await mkUser();
    expect(await transferOwnership(db, {
      clubId: '00000000-0000-0000-0000-000000000000', toUserId: target.id, actorId: admin.id,
    })).toMatchObject({ ok: false, error: 'club_not_found' });
  });

  // Presence-only atomicity checks are worthless here: `rejects.toThrow()` passes just
  // as happily when the audit insert has been moved AFTER the commit. The state
  // assertion is the part that can tell those apart, so it is the point of this test.
  it('rolls the role changes back when the audit insert fails', async () => {
    const oldOwner = await mkUser();
    const newOwner = await mkUser();
    const club = await mkClub('tr');
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: newOwner.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);

    // A non-existent actor violates `audit_log.actor_user_id`'s foreign key, so the
    // audit INSERT — and only it — fails.
    await expect(transferOwnership(db, { clubId: club.id, toUserId: newOwner.id, actorId: `u-${randomUUID()}` }))
      .rejects.toThrow();

    expect(await ownerIdsOf(club.id)).toEqual([oldOwner.id]);
    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    expect(rows.find((m) => m.userId === newOwner.id)?.role).toBe('member');
  });

  // Two admins reassigning the same club at once. `transferOwnership` READS the
  // memberships and then writes two of them, which is the same check-then-act shape
  // that let two concurrent decisions both win in `decideClubRequest`. With no lock at
  // all, READ COMMITTED lets the loser's demote re-evaluate `role = 'owner'` against
  // the winner's committed row, match nothing, and promote a SECOND owner.
  //
  // This case does NOT by itself justify locking the club row: the two racers share
  // the old owner's membership row, so a lock on `role = 'owner'` would serialise them
  // here too. The ownerless case below is what separates the two designs.
  it('never leaves two owners or none when two transfers race', async () => {
    const admin = await mkUser();
    const oldOwner = await mkUser();
    const a = await mkUser('A');
    const b = await mkUser('B');
    const club = await mkClub('rt');
    await db.insert(schema.memberships).values([
      { userId: oldOwner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: a.id, clubId: club.id, role: 'member', status: 'approved' },
      { userId: b.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);

    // Warm two pool connections FIRST. `db.transaction` calls `pool.connect()`, and on
    // a COLD pool the second call spends its first milliseconds on a TCP handshake and
    // auth — by which time the first transaction has already committed and the race
    // cannot occur, so the test would pass with the lock removed.
    //
    // Honest scope: it is insurance here, not the thing that makes this test work.
    // Every test above has already run queries through this pool, so it is warm by the
    // time control reaches here, and removing this warm-up still fails the mutation.
    // It is kept because that is an accident of file order — running this test first,
    // or alone, would restore the cold pool.
    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [r1, r2] = await Promise.all([
      transferOwnership(db, { clubId: club.id, toUserId: a.id, actorId: admin.id }),
      transferOwnership(db, { clubId: club.id, toUserId: b.id, actorId: admin.id }),
    ]);

    // Both are legitimate transfers, so both succeed — serialised, not refused. What
    // must never happen is the club ending up with two owners or with none.
    expect([r1.ok, r2.ok]).toEqual([true, true]);

    const owners = await ownerIdsOf(club.id);
    expect(owners).toHaveLength(1);
    expect([a.id, b.id]).toContain(owners[0]);

    const rows = await db.select().from(schema.memberships).where(eq(schema.memberships.clubId, club.id));
    expect(rows.find((m) => m.userId === oldOwner.id)?.role).toBe('member');
    // Two transfers, two audit rows — one per committed mutation, never a promote
    // that left no trace. (Chronological order is not asserted: `created_at` is
    // millisecond-precision and these two rows can share one, so which id sorts last
    // is arbitrary.)
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, club.id));
    expect(audit.map((x) => x.action)).toEqual(['club.transfer_owner', 'club.transfer_owner']);
    expect(audit.map((x) => x.target).sort()).toEqual([a.id, b.id].sort());
  });

  // THE case that justifies locking the club row rather than the owner membership rows.
  //
  // An ownerless club is precisely the club this function exists to repair, and it is
  // the one where an owner-row lock protects nothing: `WHERE role = 'owner'` matches
  // ZERO rows, so `FOR UPDATE` over it locks nothing, the two transfers never meet,
  // both demote nothing, and both promote — two owners. The club row always exists, so
  // locking it serialises the repair as well as the ordinary transfer.
  it('never produces two owners when two transfers race on an OWNERLESS club', async () => {
    const admin = await mkUser();
    const a = await mkUser('A');
    const b = await mkUser('B');
    const club = await mkClub('ro');
    await db.insert(schema.memberships).values([
      { userId: a.id, clubId: club.id, role: 'member', status: 'approved' },
      { userId: b.id, clubId: club.id, role: 'member', status: 'approved' },
    ]);
    expect(await ownerIdsOf(club.id)).toEqual([]);

    const warm = await Promise.all([pool.connect(), pool.connect()]);
    for (const c of warm) c.release();

    const [r1, r2] = await Promise.all([
      transferOwnership(db, { clubId: club.id, toUserId: a.id, actorId: admin.id }),
      transferOwnership(db, { clubId: club.id, toUserId: b.id, actorId: admin.id }),
    ]);

    expect([r1.ok, r2.ok]).toEqual([true, true]);
    expect(await ownerIdsOf(club.id)).toHaveLength(1);

    // Serialisation is visible in `fromUserId`: whichever ran first found no owner to
    // demote (`null`), and the second demoted the first one's target. Two `null`s here
    // would mean the transactions never saw each other, which is the bug.
    const fromIds = [r1, r2].map((r) => (r.ok ? r.fromUserId : 'refused'));
    expect(fromIds.filter((f) => f === null)).toHaveLength(1);
    expect(fromIds.filter((f) => f !== null)).toHaveLength(1);
  });

  it('getClubAdminDetail reports owners, member counts and transfer candidates', async () => {
    const owner = await mkUser('Owner');
    const approved = await mkUser('Approved');
    const pending = await mkUser('Pending');
    const banned = await mkUser('Banned');
    const club = await mkClub('gd');
    await db.insert(schema.memberships).values([
      { userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' },
      { userId: approved.id, clubId: club.id, role: 'member', status: 'approved' },
      { userId: pending.id, clubId: club.id, role: 'member', status: 'pending' },
      { userId: banned.id, clubId: club.id, role: 'member', status: 'banned' },
    ]);
    await db.insert(schema.boatTypes).values([
      { clubId: club.id, name: 'Quad', seats: 4 },
      { clubId: club.id, name: 'Single', seats: 1 },
    ]);
    await db.insert(schema.scheduleWindows).values({
      clubId: club.id, weekday: 1, startTime: '07:00', endTime: '09:00', defaultSessionMinutes: 60,
    });

    const detail = await getClubAdminDetail(db, club.id);
    expect(detail).not.toBeNull();
    expect(detail?.club.id).toBe(club.id);
    expect(detail?.owners.map((o) => o.userId)).toEqual([owner.id]);
    expect(detail?.owners[0].email).toBe(owner.email);
    expect(detail?.memberCounts).toEqual({ approved: 2, pending: 1, rejected: 0, banned: 1 });
    // Candidates are approved non-owners only: the current owner, the pending member
    // and the banned member must not be offered, because `transferOwnership` refuses
    // every one of them — offering them produces a guaranteed error toast.
    expect(detail?.transferCandidates.map((c) => c.userId)).toEqual([approved.id]);
    expect(detail?.transferCandidatesTruncated).toBe(false);
    expect(detail?.boatCount).toBe(2);
    expect(detail?.windowCount).toBe(1);
  });

  // The candidate list is capped, and the cap is ALPHABETICAL — so on an oversized club
  // the tail of the alphabet is absent from the picker. That has to be reported, or an
  // operator cannot tell it from "that person is not a member".
  it('flags the candidate list as truncated at the cap, without capping the counts', async () => {
    const owner = await mkUser('Owner');
    const club = await mkClub('gt');
    const extra = TRANSFER_CANDIDATE_LIMIT + 5;
    const people = Array.from({ length: extra }, (_, i) => ({
      id: `u-${randomUUID()}`,
      // Zero-padded so the alphabetical order is the numeric one and the cap is
      // observable: the last five names must be the ones missing.
      name: `M${String(i).padStart(4, '0')}`,
    }));
    await db.insert(schema.user).values(people.map((p) => ({ id: p.id, name: p.name, email: `${p.id}@t.co` })));
    await db.insert(schema.memberships).values([
      { userId: owner.id, clubId: club.id, role: 'owner' as const, status: 'approved' as const },
      ...people.map((p) => ({ userId: p.id, clubId: club.id, role: 'member' as const, status: 'approved' as const })),
    ]);

    const detail = await getClubAdminDetail(db, club.id);
    expect(detail?.transferCandidates).toHaveLength(TRANSFER_CANDIDATE_LIMIT);
    expect(detail?.transferCandidatesTruncated).toBe(true);
    // The truncation is alphabetical, which is the part that makes it worth saying out
    // loud: the picker holds M0000… and not the tail.
    expect(detail?.transferCandidates[0].name).toBe('M0000');
    expect(detail?.transferCandidates.at(-1)?.name).toBe(`M${String(TRANSFER_CANDIDATE_LIMIT - 1).padStart(4, '0')}`);
    // Counts come from a GROUP BY, not from the capped list, so the page still reports
    // the club's real size rather than the cap.
    expect(detail?.memberCounts.approved).toBe(extra + 1);
  });

  // Counts must be scoped to THIS club, or a busy neighbour inflates every number an
  // admin uses to decide whether a club is real.
  it('getClubAdminDetail counts nothing from a neighbouring club', async () => {
    const stranger = await mkUser();
    const club = await mkClub('gn');
    const other = await mkClub('go');
    await db.insert(schema.memberships).values({ userId: stranger.id, clubId: other.id, role: 'owner', status: 'approved' });
    await db.insert(schema.boatTypes).values({ clubId: other.id, name: 'Eight', seats: 8 });

    const detail = await getClubAdminDetail(db, club.id);
    expect(detail?.owners).toEqual([]);
    expect(detail?.transferCandidates).toEqual([]);
    expect(detail?.memberCounts).toEqual({ approved: 0, pending: 0, rejected: 0, banned: 0 });
    expect(detail?.boatCount).toBe(0);
  });

  it('getClubAdminDetail resolves the reviewer name', async () => {
    const reviewer = await mkUser('Reviewer');
    const [club] = await db.insert(schema.clubs).values({
      slug: `gr-${randomUUID()}`, name: 'Gr', status: 'active',
      reviewedBy: reviewer.id, reviewedAt: new Date(), reviewNote: 'Looks legitimate',
    }).returning();

    const detail = await getClubAdminDetail(db, club.id);
    expect(detail?.reviewedByName).toBe('Reviewer');
    expect(detail?.club.reviewNote).toBe('Looks legitimate');
  });

  it('getClubAdminDetail returns null for an unknown id', async () => {
    expect(await getClubAdminDetail(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('listClubsForAdmin searches case-insensitively on name and slug, and paginates', async () => {
    const stamp = `lc${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 3; i++) {
      await db.insert(schema.clubs).values({ slug: `${stamp}-${i}`, name: `Club ${stamp} ${i}`, status: 'active' });
    }
    const first = await listClubsForAdmin(db, { q: stamp.toUpperCase(), page: 1, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(3);
    const second = await listClubsForAdmin(db, { q: stamp, page: 2, pageSize: 2 });
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(3);
  });

  it('listClubsForAdmin never returns more rows than the page size', async () => {
    const { rows } = await listClubsForAdmin(db, { pageSize: 3 });
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  // `_` is the decoy. A test that only covers `%` passes with a half-written escape,
  // and an unescaped `_` is the worse of the two failures: it silently WIDENS the
  // result set with no wildcard character on screen to explain why.
  it('listClubsForAdmin treats LIKE metacharacters in the search term as literals', async () => {
    const stamp = randomUUID().slice(0, 8);
    const [underscore] = await db.insert(schema.clubs)
      .values({ slug: `u_${stamp}`, name: `Lit_${stamp}`, status: 'active' }).returning();
    // Matches `Lit_<stamp>` only if `_` is left as a single-character wildcard.
    await db.insert(schema.clubs).values({ slug: `ux${stamp}`, name: `LitX${stamp}`, status: 'active' });
    const [percent] = await db.insert(schema.clubs)
      .values({ slug: `p-${stamp}`, name: `Pct%${stamp}`, status: 'active' }).returning();
    // Matches `Pct%<stamp>` only if `%` is left as a multi-character wildcard.
    await db.insert(schema.clubs).values({ slug: `pz-${stamp}`, name: `PctZZ${stamp}`, status: 'active' });

    const underscoreHit = await listClubsForAdmin(db, { q: `Lit_${stamp}` });
    expect(underscoreHit.total).toBe(1);
    expect(underscoreHit.rows.map((r) => r.id)).toEqual([underscore.id]);

    const percentHit = await listClubsForAdmin(db, { q: `Pct%${stamp}` });
    expect(percentHit.total).toBe(1);
    expect(percentHit.rows.map((r) => r.id)).toEqual([percent.id]);

    // A lone backslash is the third metacharacter: unescaped it consumes the next
    // character's meaning, so `Lit\_` would match nothing at all.
    const backslash = await listClubsForAdmin(db, { q: `Lit\\_${stamp}` });
    expect(backslash.total).toBe(0);
  });

  // The page number is interpolated into OFFSET, which Postgres parses as `bigint`.
  // Every one of these raised `invalid input syntax for type bigint` out of the render
  // before the clamp moved into this function; `Math.floor` alone does not save `1e20`.
  it('listClubsForAdmin clamps a hostile page number instead of handing it to OFFSET', async () => {
    // Crashing values first, so a regression surfaces as the `bigint` error it really
    // is rather than as a tidier assertion failure on `1.5` before we ever get there.
    for (const page of [1e20, Number.POSITIVE_INFINITY, Number.NaN, 1.5, 0, -3]) {
      const res = await listClubsForAdmin(db, { page, pageSize: 2 });
      expect(Number.isSafeInteger(res.page)).toBe(true);
      expect(res.page).toBeGreaterThanOrEqual(1);
    }
  });

  it('listClubsForAdmin counts this club\'s members and not a neighbour\'s', async () => {
    const stamp = randomUUID().slice(0, 8);
    const [mine] = await db.insert(schema.clubs)
      .values({ slug: `mc-${stamp}`, name: `Counted ${stamp}`, status: 'active' }).returning();
    const [neighbour] = await db.insert(schema.clubs)
      .values({ slug: `nc-${stamp}`, name: `Counted ${stamp} neighbour`, status: 'active' }).returning();
    const a = await mkUser();
    const b = await mkUser();
    await db.insert(schema.memberships).values([
      { userId: a.id, clubId: mine.id, role: 'owner' as const, status: 'approved' as const },
      { userId: b.id, clubId: neighbour.id, role: 'member' as const, status: 'approved' as const },
    ]);

    const { rows } = await listClubsForAdmin(db, { q: `Counted ${stamp}` });
    expect(rows.find((r) => r.id === mine.id)?.memberCount).toBe(1);
    expect(rows.find((r) => r.id === neighbour.id)?.memberCount).toBe(1);
  });

  it('listPendingClubRequests returns only pending clubs, with the requester attached', async () => {
    const requester = await mkUser();
    const stamp = randomUUID().slice(0, 8);
    const [pendingClub] = await db.insert(schema.clubs)
      .values({ slug: `pq-${stamp}`, name: 'Pending Q', status: 'pending', createdBy: requester.id }).returning();
    await db.insert(schema.clubs).values({ slug: `aq-${stamp}`, name: 'Active Q', status: 'active' });
    await db.insert(schema.clubs).values({ slug: `rq-${stamp}`, name: 'Rejected Q', status: 'rejected' });

    const { rows } = await lastQueuePage();
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pendingClub.id);
    expect(rows.find((r) => r.id === pendingClub.id)?.requesterEmail).toBe(requester.email);
    expect(rows.every((r) => r.name !== 'Active Q' && r.name !== 'Rejected Q')).toBe(true);
  });

  it('listPendingClubRequests keeps a request whose requester account is gone', async () => {
    const requester = await mkUser();
    const [club] = await db.insert(schema.clubs)
      .values({ slug: `orph-${randomUUID().slice(0, 8)}`, name: 'Orphaned Request', status: 'pending', createdBy: requester.id })
      .returning();
    await db.delete(schema.user).where(eq(schema.user.id, requester.id));

    const { rows } = await lastQueuePage();
    const hit = rows.find((r) => r.id === club.id);
    expect(hit).toBeDefined();
    expect(hit?.requesterEmail).toBeNull();
  });

  // The queue does NOT self-drain. `requestClub` writes `status: 'pending'` with no
  // expiry and no TTL, there is no sweeper anywhere in the repo, nothing decides a
  // request except a human, and signup is open — so a fortnight of admin absence, or
  // one motivated user with a few verified addresses, leaves thousands of rows that
  // this page would select and render in full, each one mounting a client component
  // with its own `useActionState` and `Dialog`. That is the §6.4 defect this cycle
  // exists to remove, sitting on the page an admin must load to fix the situation.
  it('listPendingClubRequests never returns more rows than the page size', async () => {
    const stamp = randomUUID().slice(0, 8);
    await db.insert(schema.clubs).values(
      Array.from({ length: 7 }, (_, i) => ({ slug: `qp-${stamp}-${i}`, name: `Queue ${stamp} ${i}`, status: 'pending' as const })),
    );
    const { rows, total } = await listPendingClubRequests(db, { pageSize: 3 });
    expect(rows).toHaveLength(3);
    expect(total).toBeGreaterThanOrEqual(7);
  });

  it('listPendingClubRequests paginates without repeating or dropping a request', async () => {
    const stamp = randomUUID().slice(0, 8);
    const inserted = await db.insert(schema.clubs).values(
      Array.from({ length: 5 }, (_, i) => ({ slug: `qq-${stamp}-${i}`, name: `Page ${stamp} ${i}`, status: 'pending' as const })),
    ).returning({ id: schema.clubs.id });

    // The last three pages of two, which always covers at least the six newest rows and
    // therefore all five fixtures — walking the WHOLE queue would be thousands of
    // round trips against a database this suite has been appending to all along.
    const pageSize = 2;
    const { total } = await listPendingClubRequests(db, { pageSize });
    const lastPage = Math.ceil(total / pageSize);
    const seen: string[] = [];
    for (let p = Math.max(1, lastPage - 2); p <= lastPage; p++) {
      const { rows } = await listPendingClubRequests(db, { page: p, pageSize });
      expect(rows.length).toBeLessThanOrEqual(pageSize);
      seen.push(...rows.map((r) => r.id));
    }
    expect(new Set(seen).size).toBe(seen.length); // no row served twice
    for (const { id } of inserted) expect(seen).toContain(id); // and none skipped
  });

  // Oldest first. With the queue paged, the order decides what an admin ever SEES:
  // newest-first would park the request that has waited longest on the last page and
  // leave it there indefinitely, which is how a backlog starves rather than drains.
  //
  // Asserted on the shape of the page rather than on where two fixtures land in it:
  // this suite shares a database it has been appending pending rows to, so "my row is
  // first" is not a property any single test can own.
  it('listPendingClubRequests serves the longest-waiting requests first', async () => {
    const stamp = randomUUID().slice(0, 8);
    await db.insert(schema.clubs).values(
      Array.from({ length: 2 }, (_, i) => ({ slug: `ord-${stamp}-${i}`, name: `Ord ${stamp} ${i}`, status: 'pending' as const })),
    );

    const { rows } = await listPendingClubRequests(db, { pageSize: 50 });
    const times = rows.map((r) => r.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    // Not a constant run, which would satisfy both directions and prove nothing.
    expect(times.at(-1)).toBeGreaterThan(times[0]);
  });

  // Same `bigint` hazard as the clubs list, and the same reason the clamp belongs in
  // the library: a route-only guard still lets a direct call — which is how these tests
  // call it — hand `1e20` to OFFSET.
  it('listPendingClubRequests clamps a hostile page number instead of handing it to OFFSET', async () => {
    for (const page of [1e20, Number.POSITIVE_INFINITY, Number.NaN, 1.5, 0, -3]) {
      const res = await listPendingClubRequests(db, { page, pageSize: 2 });
      expect(Number.isSafeInteger(res.page)).toBe(true);
      expect(res.page).toBeGreaterThanOrEqual(1);
    }
  });
});
