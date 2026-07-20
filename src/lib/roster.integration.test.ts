import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { zonedWallClockToUtc } from './date-tz';
import { getDayRoster } from './roster';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Europe/Istanbul';
const MON = '2026-07-20';
const START = zonedWallClockToUtc(MON, '08:00', TZ);
const END = zonedWallClockToUtc(MON, '09:00', TZ);

describe.skipIf(!url)('getDayRoster', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  beforeAll(async () => { pool = new Pool({ connectionString: url }); db = drizzle(pool, { schema }); await migrate(db, { migrationsFolder: './drizzle' }); });
  afterAll(async () => { await pool.end(); });

  let seq = 0;
  async function seed() {
    const tag = `rst-${Date.now()}-${seq++}`;
    const [club] = await db.insert(schema.clubs).values({ slug: tag, name: tag, status: 'active', timezone: TZ }).returning();
    const [boat] = await db.insert(schema.boatTypes).values({ clubId: club.id, name: 'Quad', seats: 1, allowedPayment: 'both' }).returning();
    const [w] = await db.insert(schema.scheduleWindows).values({ clubId: club.id, weekday: 1, startTime: '08:00', endTime: '09:00', defaultSessionMinutes: 60 }).returning();
    await db.insert(schema.windowBoats).values({ windowId: w.id, boatTypeId: boat.id, quantity: 1 });
    const [slot] = await db.insert(schema.slots).values({ clubId: club.id, date: MON, startAt: START, endAt: END, fromWindowId: w.id }).returning();
    const [session] = await db.insert(schema.sessions).values({ slotId: slot.id, clubId: club.id, boatTypeId: boat.id, capacity: 1 }).returning();
    const mk = async (name: string, status: 'booked' | 'waitlisted', qpos: number | null) => {
      const uid = `${tag}-${name}`;
      await db.insert(schema.user).values({ id: uid, name, email: `${uid}@t.co` });
      await db.insert(schema.bookings).values({ sessionId: session.id, clubId: club.id, userId: uid, paymentType: 'regular', status, queuePosition: qpos, effectiveAt: START });
    };
    await mk('alice', 'booked', null);
    await mk('bob', 'waitlisted', 1);
    return { club, windowId: w.id };
  }

  it('returns each session with its seated and waitlisted roster', async () => {
    const { club, windowId } = await seed();
    const roster = await getDayRoster(db, { clubId: club.id, dateISO: MON });
    const sess = roster.sessions.find((x) => x.startAt.getTime() === START.getTime());
    expect(sess).toBeTruthy();
    expect(sess!.boatName).toBe('Quad');
    expect(sess!.windowId).toBe(windowId);
    expect(sess!.seated.map((m) => m.name)).toEqual(['alice']);
    expect(sess!.waitlisted.map((m) => m.name)).toEqual(['bob']);
    expect(sess!.freeSeats).toBe(0);
  });
});
