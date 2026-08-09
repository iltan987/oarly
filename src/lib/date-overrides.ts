import { and, eq, gte, lt } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubHolidayOverrides } from '@/db/schema';
import { logAudit } from '@/lib/audit';

import { addDaysISO } from './date-tz';

export async function listOverrides(
  db: DB,
  clubId: string,
  opts: { fromDateISO: string; days: number },
): Promise<{ dateISO: string; isOpen: boolean }[]> {
  const endISO = addDaysISO(opts.fromDateISO, opts.days); // exclusive
  const rows = await db
    .select({ date: clubHolidayOverrides.date, isOpen: clubHolidayOverrides.isOpen })
    .from(clubHolidayOverrides)
    .where(and(
      eq(clubHolidayOverrides.clubId, clubId),
      gte(clubHolidayOverrides.date, opts.fromDateISO),
      lt(clubHolidayOverrides.date, endISO),
    ));
  return rows.map((r) => ({ dateISO: r.date, isOpen: r.isOpen }));
}

/**
 * Opening or closing a date changes what every member of the club can book that
 * day, so both mutations below are wrapped in a transaction for their audit row
 * (spec §4.3). `target` is the date itself — it repeats across clubs, so a reader
 * of the log must pair it with `clubId`. Both writes are keyed on `clubId`, so the
 * logged club is always the one whose row actually changed.
 */
export async function setDateOverride(
  db: DB,
  clubId: string,
  input: { dateISO: string; isOpen: boolean },
  actorId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .insert(clubHolidayOverrides)
      .values({ clubId, date: input.dateISO, isOpen: input.isOpen })
      .onConflictDoUpdate({
        target: [clubHolidayOverrides.clubId, clubHolidayOverrides.date],
        set: { isOpen: input.isOpen },
      });
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'date_override.set', target: input.dateISO, actingAsRole: 'owner' });
    return true;
  });
}

export async function clearDateOverride(db: DB, clubId: string, dateISO: string, actorId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(clubHolidayOverrides)
      .where(and(eq(clubHolidayOverrides.clubId, clubId), eq(clubHolidayOverrides.date, dateISO)))
      .returning({ id: clubHolidayOverrides.id });
    if (removed.length === 0) return false;
    await logAudit(tx, { actorUserId: actorId, clubId, action: 'date_override.clear', target: dateISO, actingAsRole: 'owner' });
    return true;
  });
}
