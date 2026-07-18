import { and, eq, gte, lt } from 'drizzle-orm';

import type { DB } from '@/db';
import { clubHolidayOverrides } from '@/db/schema';

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

export async function setDateOverride(
  db: DB,
  clubId: string,
  input: { dateISO: string; isOpen: boolean },
): Promise<boolean> {
  await db
    .insert(clubHolidayOverrides)
    .values({ clubId, date: input.dateISO, isOpen: input.isOpen })
    .onConflictDoUpdate({
      target: [clubHolidayOverrides.clubId, clubHolidayOverrides.date],
      set: { isOpen: input.isOpen },
    });
  return true;
}

export async function clearDateOverride(db: DB, clubId: string, dateISO: string): Promise<boolean> {
  const removed = await db
    .delete(clubHolidayOverrides)
    .where(and(eq(clubHolidayOverrides.clubId, clubId), eq(clubHolidayOverrides.date, dateISO)))
    .returning({ id: clubHolidayOverrides.id });
  return removed.length > 0;
}
