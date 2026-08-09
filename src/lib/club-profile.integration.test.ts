import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { addSocial, listSocials, ownedClubId, removeSocial, setClubLogo, updateClubProfile } from './club-profile';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('club-profile', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); actor = await newUser(); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  let actor: string;
  async function newUser() {
    const id = `cp-u-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id, name: 'O', email: `${id}@t.co` });
    return id;
  }
  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${randomUUID()}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('updates profile fields and logo', async () => {
    const c = await newClub('cp-upd');
    expect(await updateClubProfile(db, c.id, { name: 'Bebek Kürek', tagline: 'İstanbul', description: 'Bir kulüp', phone: '555', brandAccent: '#0E9E93', headingFont: 'premium', logoUrl: 'https://blob/x.png' }, actor)).toBe(true);
    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(after.name).toBe('Bebek Kürek');
    expect(after.tagline).toBe('İstanbul');
    expect(after.description).toBe('Bir kulüp');
    expect(after.phone).toBe('555');
    expect(after.brandAccent).toBe('#0E9E93');
    expect(after.headingFont).toBe('premium');
    expect(after.logoUrl).toBe('https://blob/x.png');
  });

  it('sets and clears the logo independently of other profile fields', async () => {
    const c = await newClub('cp-logo');
    await updateClubProfile(db, c.id, { name: 'Keep Me', tagline: null, description: null, phone: null, brandAccent: null, headingFont: 'default', logoUrl: null }, actor);
    await setClubLogo(db, c.id, 'https://blob/logo.png');
    let [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(row.logoUrl).toBe('https://blob/logo.png');
    expect(row.name).toBe('Keep Me'); // other fields untouched
    await setClubLogo(db, c.id, null);
    [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(row.logoUrl).toBeNull();
    expect(row.name).toBe('Keep Me');
  });

  it('adds, lists, and removes socials scoped to the club', async () => {
    const c1 = await newClub('cp-s1');
    const c2 = await newClub('cp-s2');
    const id = await addSocial(db, { clubId: c1.id, platform: 'instagram', handle: 'bebek' });
    expect((await listSocials(db, c1.id)).map((s) => s.handle)).toEqual(['bebek']);
    // wrong club cannot remove, and the social row must still exist
    expect(await removeSocial(db, { clubId: c2.id, socialId: id })).toBe(false);
    const stillThere = await listSocials(db, c1.id);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].handle).toBe('bebek');
    expect(await removeSocial(db, { clubId: c1.id, socialId: id })).toBe(true);
    expect(await listSocials(db, c1.id)).toHaveLength(0);
  });

  it('ownedClubId returns the club only for an approved owner', async () => {
    const c = await newClub('cp-own');
    const owner = `o-${randomUUID()}`;
    const member = `m-${randomUUID()}`;
    const pendingOwner = `po-${randomUUID()}`;
    await db.insert(schema.user).values([
      { id: owner, name: 'O', email: `${owner}@t.co` },
      { id: member, name: 'M', email: `${member}@t.co` },
      { id: pendingOwner, name: 'PO', email: `${pendingOwner}@t.co` },
    ]);
    await db.insert(schema.memberships).values({ userId: owner, clubId: c.id, role: 'owner', status: 'approved' });
    await db.insert(schema.memberships).values({ userId: member, clubId: c.id, role: 'member', status: 'approved' });
    await db.insert(schema.memberships).values({ userId: pendingOwner, clubId: c.id, role: 'owner', status: 'pending' });
    expect(await ownedClubId(db, owner, c.slug)).toBe(c.id);
    expect(await ownedClubId(db, member, c.slug)).toBeNull();
    // owner role alone is not sufficient — status must also be 'approved'
    expect(await ownedClubId(db, pendingOwner, c.slug)).toBeNull();
    expect(await ownedClubId(db, owner, 'no-such-slug')).toBeNull();
  });

  it('does not grant ownership over a rejected club via its slug', async () => {
    const slug = `cp-rej-${randomUUID()}`;
    const [rejected] = await db.insert(schema.clubs)
      .values({ slug, name: 'Rejected', status: 'rejected' }).returning();
    const owner = `ro-${randomUUID()}`;
    await db.insert(schema.user).values({ id: owner, name: 'RO', email: `${owner}@t.co` });
    // requestClub gives the requester an approved owner membership, which survives
    // rejection — so the only thing standing between them and a write is the status filter.
    await db.insert(schema.memberships)
      .values({ userId: owner, clubId: rejected.id, role: 'owner', status: 'approved' });
    expect(await ownedClubId(db, owner, slug)).toBeNull();
  });

  /**
   * `ownedClubId` is the TERMINAL authorization decision for the two club-logo Route
   * Handlers — they never pass through `requireOwner`/`requireActiveClub` — so a
   * suspended club's owner must not get an id back from it. With the old
   * "not rejected" filter, `POST /api/club-logo/save` returned 200 for a suspended
   * club and changed `logo_url`, and `setClubLogo` is deliberately unaudited, so the
   * write left no trace (spec §2).
   */
  it.each(['suspended', 'pending', 'rejected'] as const)(
    'refuses ownedClubId for the legitimate owner of a %s club',
    async (status) => {
      const slug = `cp-inactive-${status}-${randomUUID()}`;
      const [club] = await db.insert(schema.clubs)
        .values({ slug, name: `Inactive ${status}`, status }).returning();
      const owner = await newUser();
      await db.insert(schema.memberships)
        .values({ userId: owner, clubId: club.id, role: 'owner', status: 'approved' });
      expect(await ownedClubId(db, owner, slug)).toBeNull();
    },
  );

  it('still allows the owner of an ACTIVE club through', async () => {
    const c = await newClub('cp-active-ok');
    const owner = await newUser();
    await db.insert(schema.memberships).values({ userId: owner, clubId: c.id, role: 'owner', status: 'approved' });
    expect(await ownedClubId(db, owner, c.slug)).toBe(c.id);
  });

  it('audits club.profile_update against the club itself', async () => {
    const c = await newClub('cp-audit');
    const owner = await newUser();
    expect(await updateClubProfile(db, c.id, { name: 'Audited', tagline: null, description: null, phone: null, brandAccent: null, headingFont: 'default', logoUrl: null }, owner)).toBe(true);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, c.id));
    expect(rows.map((a) => a.action)).toEqual(['club.profile_update']);
    expect(rows[0].target).toBe(c.id);
    expect(rows[0].actorUserId).toBe(owner);
    expect(rows[0].actingAsRole).toBe('owner');
  });

  it('leaves the cosmetic logo and social mutations unaudited (spec §4.2)', async () => {
    const c = await newClub('cp-unaudited');
    await setClubLogo(db, c.id, 'https://blob/logo.png');
    const socialId = await addSocial(db, { clubId: c.id, platform: 'instagram', handle: 'x' });
    expect(await removeSocial(db, { clubId: c.id, socialId })).toBe(true);
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.clubId, c.id))).toHaveLength(0);
  });

  // See the equivalent probe in scheduling-settings: a real FK violation inside the
  // transaction, asserted by the mutation NOT taking effect.
  it('rolls the profile change back when the audit insert fails', async () => {
    const c = await newClub('cp-atomic');
    await expect(updateClubProfile(db, c.id, { name: 'Ghost', tagline: null, description: null, phone: null, brandAccent: null, headingFont: 'default', logoUrl: null }, 'no-such-user'))
      .rejects.toThrow();
    const [row] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(row.name).toBe('cp-atomic');
  });
});
