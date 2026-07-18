import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { bookSeat } from './booking';
import { zonedWallClockToUtc } from './date-tz';
import { computeMemberCalendar, type MemberContext } from './member-calendar';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);

describe.skipIf(!url)('computeMemberCalendar', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function setup(allowedPayment: 'regular_only' | 'multisport_only' | 'both' = 'both', minSkillRank?: number) {
    const tag = `mc-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ, bookingOpenMode: 'always' }).returning();
    let lvl; if (minSkillRank != null) [lvl] = await db.insert(schema.skillLevels).values({ clubId: club.id, name: 'L', rank: minSkillRank }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 2, allowedPayment, minSkillLevelId: lvl?.id ?? null }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
    return { club, boat, w };
  }
  const ctx = (userId: string, over: Partial<MemberContext> = {}): MemberContext => ({ userId, membershipStatus: 'approved', bannedUntil: null, skillRank: null, paymentType: 'regular', ...over });
  const opts = { fromDateISO: MON, days: 1, now: new Date('2026-07-01T00:00:00Z') };

  it('reports full seatsLeft and none myStatus for a virtual (unbooked) session', async () => {
    const s = await setup();
    const days = await computeMemberCalendar(db, s.club.id, ctx('nobody'), opts);
    const session = days[0].slots[0].sessions[0];
    expect(session.seatsLeft).toBe(2);
    expect(session.myStatus).toBe('none');
    expect(session.bookingOpen).toBe(true);
    expect(session.eligibility).toEqual({ ok: true });
    expect(session.paymentChoices).toEqual(['regular', 'multisport']);
    expect(session.defaultPayment).toBe('regular');
  });

  it('reflects a booking: seatsLeft drops and myStatus shows booked for the booker', async () => {
    const s = await setup();
    const uid = `mem-${Date.now()}-${seq++}`;
    await db.insert(schema.user).values({ id: uid, name: 'M', email: `${uid}@t.co` });
    await db.insert(schema.memberships).values({ userId: uid, clubId: s.club.id, role: 'member', status: 'approved' });
    await bookSeat(db, { clubId: s.club.id, userId: uid, windowId: s.w.id, boatTypeId: s.boat.id, startAt: START, paymentType: 'regular', idempotencyKey: `k-${seq++}`, now: opts.now });
    const mine = await computeMemberCalendar(db, s.club.id, ctx(uid), opts);
    const other = await computeMemberCalendar(db, s.club.id, ctx('someone-else'), opts);
    expect(mine[0].slots[0].sessions[0].myStatus).toBe('booked');
    expect(mine[0].slots[0].sessions[0].seatsLeft).toBe(1);
    expect(other[0].slots[0].sessions[0].myStatus).toBe('none');
    expect(other[0].slots[0].sessions[0].seatsLeft).toBe(1);
  });

  it('marks skill-gated sessions ineligible and locks payment choices for single-type boats', async () => {
    const s = await setup('multisport_only', 5);
    const days = await computeMemberCalendar(db, s.club.id, ctx('n', { skillRank: 1 }), opts);
    const session = days[0].slots[0].sessions[0];
    expect(session.eligibility).toEqual({ ok: false, reason: 'skill_too_low' });
    expect(session.paymentChoices).toEqual(['multisport']);
    expect(session.defaultPayment).toBe('multisport');
  });
});
