import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { countMultisportOnlyBoats, createBoat, listBoats, setBoatActive, updateBoat } from './boats';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('boats', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); actor = await newUser(); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  let actor: string;
  async function newUser() {
    const id = `boat-u-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id, name: 'O', email: `${id}@t.co` });
    return id;
  }
  async function newClub(tag: string) {
    const [c] = await db.insert(schema.clubs).values({ slug: `${tag}-${randomUUID()}`, name: tag, status: 'active' }).returning();
    return c;
  }

  it('creates and lists boats scoped to the club', async () => {
    const c = await newClub('boat-c');
    const r = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 2 }, actor);
    expect(r.ok).toBe(true);
    const boats = await listBoats(db, c.id);
    expect(boats).toHaveLength(1);
    expect(boats[0].name).toBe('Quad');
    expect(boats[0].active).toBe(true);
  });

  it('rejects a min skill level from another club', async () => {
    const c1 = await newClub('boat-s1');
    const c2 = await newClub('boat-s2');
    const [otherLvl] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Adv', rank: 1 }).returning();
    const r = await createBoat(db, c1.id, { name: 'Double', seats: 2, minSkillLevelId: otherLvl.id, allowedPayment: 'regular_only', minAttendance: null }, actor);
    expect(r).toEqual({ ok: false, error: 'skill_not_in_club' });
    expect(await listBoats(db, c1.id)).toHaveLength(0);
  });

  it('updates only within the same club and validates the skill FK', async () => {
    const c1 = await newClub('boat-u1');
    const c2 = await newClub('boat-u2');
    const created = await createBoat(db, c1.id, { name: 'Single', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    if (!created.ok) throw new Error('setup');
    // wrong club → not_found
    expect(await updateBoat(db, { clubId: c2.id, boatId: created.id, name: 'Hacked', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null, actorId: actor })).toEqual({ ok: false, error: 'not_found' });
    // valid update
    expect(await updateBoat(db, { clubId: c1.id, boatId: created.id, name: 'Skiff', seats: 1, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null, actorId: actor })).toEqual({ ok: true });
    const [after] = await listBoats(db, c1.id);
    expect(after.name).toBe('Skiff');
    expect(after.allowedPayment).toBe('multisport_only');
  });

  it('soft-deactivates and reactivates', async () => {
    const c = await newClub('boat-a');
    const created = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    if (!created.ok) throw new Error('setup');
    expect(await setBoatActive(db, { clubId: c.id, boatId: created.id, active: false, actorId: actor })).toBe(true);
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.active).toBe(false);
    expect(await setBoatActive(db, { clubId: c.id, boatId: created.id, active: true, actorId: actor })).toBe(true);
    const [row2] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row2.active).toBe(true);
  });

  it('rejects an update that references a skill level from another club and leaves the row unchanged', async () => {
    const c1 = await newClub('boat-uf1');
    const c2 = await newClub('boat-uf2');
    const created = await createBoat(db, c1.id, { name: 'Single', seats: 1, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    if (!created.ok) throw new Error('setup');
    const [otherLvl] = await db.insert(schema.skillLevels).values({ clubId: c2.id, name: 'Adv', rank: 1 }).returning();
    const r = await updateBoat(db, { clubId: c1.id, boatId: created.id, name: 'Hacked', seats: 9, minSkillLevelId: otherLvl.id, allowedPayment: 'multisport_only', minAttendance: 5, actorId: actor });
    expect(r).toEqual({ ok: false, error: 'skill_not_in_club' });
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.name).toBe('Single');
    expect(row.minSkillLevelId).toBeNull();
    expect(row.seats).toBe(1);
    expect(row.allowedPayment).toBe('both');
  });

  it('does not deactivate a boat when scoped to the wrong club', async () => {
    const c1 = await newClub('boat-w1');
    const c2 = await newClub('boat-w2');
    const created = await createBoat(db, c1.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    if (!created.ok) throw new Error('setup');
    expect(await setBoatActive(db, { clubId: c2.id, boatId: created.id, active: false, actorId: actor })).toBe(false);
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.active).toBe(true);
  });

  it('counts only multisport_only boats, scoped to the club', async () => {
    const c1 = await newClub('boat-ms1');
    const c2 = await newClub('boat-ms2');
    await createBoat(db, c1.id, { name: 'MsOnly1', seats: 2, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null }, actor);
    await createBoat(db, c1.id, { name: 'MsOnly2', seats: 2, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null }, actor);
    await createBoat(db, c1.id, { name: 'Both', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    await createBoat(db, c1.id, { name: 'CashOnly', seats: 2, minSkillLevelId: null, allowedPayment: 'regular_only', minAttendance: null }, actor);
    await createBoat(db, c2.id, { name: 'OtherClubMsOnly', seats: 2, minSkillLevelId: null, allowedPayment: 'multisport_only', minAttendance: null }, actor);
    expect(await countMultisportOnlyBoats(db, c1.id)).toBe(2);
    expect(await countMultisportOnlyBoats(db, c2.id)).toBe(1);
  });

  it('lists boats scoped to their own club only', async () => {
    const c1 = await newClub('boat-l1');
    const c2 = await newClub('boat-l2');
    const b1 = await createBoat(db, c1.id, { name: 'Club1Boat', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    const b2 = await createBoat(db, c2.id, { name: 'Club2Boat', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, actor);
    if (!b1.ok || !b2.ok) throw new Error('setup');
    const boats = await listBoats(db, c1.id);
    expect(boats).toHaveLength(1);
    expect(boats[0].id).toBe(b1.id);
    expect(boats.some((b) => b.id === b2.id)).toBe(false);
  });

  it('audits boat.create, boat.update and boat.set_active', async () => {
    const owner = await newUser();
    const c = await newClub('boat-audit');
    const created = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 }, owner);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await updateBoat(db, { clubId: c.id, boatId: created.id, actorId: owner, name: 'Quad B', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 })).toEqual({ ok: true });
    expect(await setBoatActive(db, { clubId: c.id, boatId: created.id, active: false, actorId: owner })).toBe(true);

    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, created.id));
    expect(rows.map((a) => a.action).sort()).toEqual(['boat.create', 'boat.set_active', 'boat.update']);
    expect(rows.every((a) => a.actingAsRole === 'owner' && a.actorUserId === owner && a.clubId === c.id)).toBe(true);
  });

  it('writes no audit row for a boat that belongs to another club', async () => {
    const owner = await newUser();
    const c1 = await newClub('boat-audit-x1');
    const c2 = await newClub('boat-audit-x2');
    const created = await createBoat(db, c1.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, owner);
    if (!created.ok) throw new Error('setup');
    expect(await setBoatActive(db, { clubId: c2.id, boatId: created.id, active: false, actorId: owner })).toBe(false);
    const rows = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, created.id));
    // Only the create; the cross-club attempt must not attribute anything to c2.
    expect(rows.map((a) => a.action)).toEqual(['boat.create']);
    expect(rows[0].clubId).toBe(c1.id);
  });

  it('rolls the boat creation back when the audit insert fails', async () => {
    const c = await newClub('boat-atomic');
    const before = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.clubId, c.id));
    await expect(createBoat(db, c.id, { name: 'Ghost', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: 1 }, 'no-such-user'))
      .rejects.toThrow();
    const after = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.clubId, c.id));
    expect(after).toHaveLength(before.length);
  });

  it('rolls the boat update back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('boat-atomic-u');
    const created = await createBoat(db, c.id, { name: 'Keep', seats: 2, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, owner);
    if (!created.ok) throw new Error('setup');
    await expect(updateBoat(db, { clubId: c.id, boatId: created.id, actorId: 'no-such-user', name: 'Renamed', seats: 8, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }))
      .rejects.toThrow();
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.name).toBe('Keep');
    expect(row.seats).toBe(2);
  });

  it('rolls the activation change back when the audit insert fails', async () => {
    const owner = await newUser();
    const c = await newClub('boat-atomic-a');
    const created = await createBoat(db, c.id, { name: 'Quad', seats: 4, minSkillLevelId: null, allowedPayment: 'both', minAttendance: null }, owner);
    if (!created.ok) throw new Error('setup');
    await expect(setBoatActive(db, { clubId: c.id, boatId: created.id, active: false, actorId: 'no-such-user' }))
      .rejects.toThrow();
    const [row] = await db.select().from(schema.boatTypes).where(eq(schema.boatTypes.id, created.id));
    expect(row.active).toBe(true);
  });
});
