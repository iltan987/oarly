import { describe, expect, it } from 'vitest';

import { isBookingOpen, resolveDateOpen } from './calendar-rules';

const D = '2026-07-20';

describe('resolveDateOpen', () => {
  const base = { dateISO: D, openOnHolidays: false, approvedHolidayDates: new Set<string>(), overrides: new Map<string, boolean>() };

  it('is open with no holiday and no override', () => {
    expect(resolveDateOpen(base)).toEqual({ open: true, reason: null });
  });

  it('closes on an approved holiday when the club does not open on holidays', () => {
    expect(resolveDateOpen({ ...base, approvedHolidayDates: new Set([D]) })).toEqual({ open: false, reason: 'holiday' });
  });

  it('stays open on a holiday when the club opens on holidays', () => {
    expect(resolveDateOpen({ ...base, openOnHolidays: true, approvedHolidayDates: new Set([D]) })).toEqual({ open: true, reason: null });
  });

  it('override wins over a holiday: forced open', () => {
    expect(resolveDateOpen({ ...base, approvedHolidayDates: new Set([D]), overrides: new Map([[D, true]]) })).toEqual({ open: true, reason: null });
  });

  it('override wins: forced closed on an ordinary day', () => {
    expect(resolveDateOpen({ ...base, overrides: new Map([[D, false]]) })).toEqual({ open: false, reason: 'override' });
  });
});

describe('isBookingOpen', () => {
  const startAt = new Date('2026-07-20T05:00:00.000Z');

  it('is closed once the session has started', () => {
    expect(isBookingOpen({ now: startAt, startAt, bookingOpenMode: 'always', bookingOpenLeadDays: null })).toBe(false);
  });

  it('always mode: open while the session is in the future', () => {
    expect(isBookingOpen({ now: new Date('2026-07-01T00:00:00Z'), startAt, bookingOpenMode: 'always', bookingOpenLeadDays: null })).toBe(true);
  });

  it('lead mode: closed before the lead window, open inside it', () => {
    const common = { startAt, bookingOpenMode: 'lead' as const, bookingOpenLeadDays: 3 };
    expect(isBookingOpen({ ...common, now: new Date('2026-07-16T04:59:00Z') })).toBe(false); // >3 days out
    expect(isBookingOpen({ ...common, now: new Date('2026-07-17T06:00:00Z') })).toBe(true); // within 3 days
  });

  it('lead mode with null lead days is treated as not open (defensive)', () => {
    expect(isBookingOpen({ now: new Date('2026-07-01T00:00:00Z'), startAt, bookingOpenMode: 'lead', bookingOpenLeadDays: null })).toBe(false);
  });
});
