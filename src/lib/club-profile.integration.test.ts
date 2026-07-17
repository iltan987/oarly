import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { addSocial, listSocials, ownedClubId, removeSocial, updateClubProfile } from './club-profile';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('club-profile', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${Date.now()}-${Math.round(performance.now())}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('updates profile fields and logo', async () => {
    const c = await newClub('cp-upd');
    expect(await updateClubProfile(db, c.id, { name: 'Bebek Kürek', tagline: 'İstanbul', description: 'Bir kulüp', phone: '555', brandAccent: '#0E9E93', headingFont: 'premium', logoUrl: 'https://blob/x.png' })).toBe(true);
    const [after] = await db.select().from(schema.clubs).where(eq(schema.clubs.id, c.id));
    expect(after.name).toBe('Bebek Kürek');
    expect(after.tagline).toBe('İstanbul');
    expect(after.description).toBe('Bir kulüp');
    expect(after.phone).toBe('555');
    expect(after.brandAccent).toBe('#0E9E93');
    expect(after.headingFont).toBe('premium');
    expect(after.logoUrl).toBe('https://blob/x.png');
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
    const owner = `o-${Date.now()}`;
    const member = `m-${Date.now()}`;
    const pendingOwner = `po-${Date.now()}`;
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
});
