import { addDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

function fmtUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmtLocalFields(d: Date): string {
  // `d` here is the result of toZonedTime: its LOCAL fields hold the target-zone wall clock.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** A club-local wall-clock date+time → the equivalent UTC instant. */
export function zonedWallClockToUtc(dateISO: string, timeHHMM: string, timeZone: string): Date {
  return fromZonedTime(`${dateISO}T${timeHHMM}:00`, timeZone);
}

/** A UTC instant → the club-local calendar date (YYYY-MM-DD) and weekday (0=Sun..6=Sat). */
export function utcToClubDate(instant: Date, timeZone: string): { dateISO: string; weekday: number } {
  const z = toZonedTime(instant, timeZone);
  return { dateISO: fmtLocalFields(z), weekday: z.getDay() };
}

/** Today's club-local calendar date (YYYY-MM-DD). */
export function todayInClub(now: Date, timeZone: string): string {
  return fmtLocalFields(toZonedTime(now, timeZone));
}

/** Add `n` calendar days to a YYYY-MM-DD label (timezone-independent). */
export function addDaysISO(dateISO: string, n: number): string {
  return fmtUTC(addDays(new Date(`${dateISO}T00:00:00Z`), n));
}

/** Add `n` calendar months to a YYYY-MM-DD label, clamping to the month end (timezone-independent). */
export function addMonthsISO(dateISO: string, n: number): string {
  // Parse the ISO date
  const year = parseInt(dateISO.substring(0, 4));
  const month = parseInt(dateISO.substring(5, 7));
  const day = parseInt(dateISO.substring(8, 10));

  // Calculate target year and month
  let targetYear = year;
  let targetMonth = month + n; // 1-based

  // Handle month overflow/underflow
  while (targetMonth > 12) {
    targetMonth -= 12;
    targetYear += 1;
  }
  while (targetMonth < 1) {
    targetMonth += 12;
    targetYear -= 1;
  }

  // Find the last day of the target month by creating the first day of next month and backing up one day
  let nextMonth = targetMonth + 1;
  let nextYear = targetYear;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }

  const firstOfNextMonth = new Date(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00Z`);
  firstOfNextMonth.setUTCDate(0); // Back up to the last day of the target month
  const maxDay = firstOfNextMonth.getUTCDate();

  // Clamp the day to the maximum valid day of the target month
  const clampedDay = Math.min(day, maxDay);

  // Create result string in ISO format
  return `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/** The `days` consecutive calendar-date labels starting at `fromDateISO`. */
export function eachDateISO(fromDateISO: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDaysISO(fromDateISO, i));
}

/** Weekday (0=Sun..6=Sat) of a YYYY-MM-DD label. */
export function weekdayOfDateISO(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. */
export function toMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes since midnight → "HH:MM". */
export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
