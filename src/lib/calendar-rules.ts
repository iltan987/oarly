const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve whether a date is open, with precedence:
 *   1. A club override wins (is_open=false → closed; is_open=true → open).
 *   2. Else an approved holiday closes the date only when the club does not open on holidays.
 *   3. Else open. (A weekday with no windows is still "open" — it simply has no slots.)
 */
export function resolveDateOpen(input: {
  dateISO: string;
  openOnHolidays: boolean;
  approvedHolidayDates: Set<string>;
  overrides: Map<string, boolean>;
}): { open: boolean; reason: 'holiday' | 'override' | null } {
  const { dateISO, openOnHolidays, approvedHolidayDates, overrides } = input;
  if (overrides.has(dateISO)) {
    return overrides.get(dateISO) ? { open: true, reason: null } : { open: false, reason: 'override' };
  }
  if (approvedHolidayDates.has(dateISO) && !openOnHolidays) {
    return { open: false, reason: 'holiday' };
  }
  return { open: true, reason: null };
}

/** Whether a session is currently open for booking, from the club's booking-open policy. */
export function isBookingOpen(input: {
  now: Date;
  startAt: Date;
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
}): boolean {
  const { now, startAt, bookingOpenMode, bookingOpenLeadDays } = input;
  if (startAt.getTime() <= now.getTime()) return false; // already started / past
  if (bookingOpenMode === 'always') return true;
  if (bookingOpenLeadDays == null) return false; // 5A forbids this; be safe
  const opensAt = startAt.getTime() - bookingOpenLeadDays * DAY_MS;
  return now.getTime() >= opensAt;
}

/**
 * The instant a session's booking window opens, or null when it is not lead-gated
 * (always-open clubs, or lead mode without a configured lead — mirrors isBookingOpen's
 * guards). Used to tell the member "Opens {date}" instead of a bare dash.
 */
export function bookingOpensAt(input: {
  startAt: Date;
  bookingOpenMode: 'always' | 'lead';
  bookingOpenLeadDays: number | null;
}): Date | null {
  const { startAt, bookingOpenMode, bookingOpenLeadDays } = input;
  if (bookingOpenMode === 'always') return null;
  if (bookingOpenLeadDays == null) return null;
  return new Date(startAt.getTime() - bookingOpenLeadDays * DAY_MS);
}
