import { describe, expect, it } from 'vitest';

import {
  addDaysISO, eachDateISO, minutesToHHMM, todayInClub, toMinutes, utcToClubDate, weekdayOfDateISO, zonedWallClockToUtc,
} from './date-tz';

const TZ = 'Europe/Istanbul'; // UTC+3, no DST since 2016

describe('date-tz', () => {
  it('converts club wall-clock to the correct UTC instant', () => {
    // 08:00 Istanbul on 2026-07-20 is 05:00 UTC.
    expect(zonedWallClockToUtc('2026-07-20', '08:00', TZ).toISOString()).toBe('2026-07-20T05:00:00.000Z');
  });

  it('maps a UTC instant back to the club-local date and weekday', () => {
    const r = utcToClubDate(new Date('2026-07-20T05:00:00.000Z'), TZ);
    expect(r.dateISO).toBe('2026-07-20');
    expect(r.weekday).toBe(1); // Monday
  });

  it('reports today in the club zone (after local midnight, before UTC midnight)', () => {
    // 2026-07-20T22:30Z is 2026-07-21T01:30 in Istanbul → local date already rolled over.
    expect(todayInClub(new Date('2026-07-20T22:30:00.000Z'), TZ)).toBe('2026-07-21');
  });

  it('does calendar-date arithmetic independent of timezone', () => {
    expect(addDaysISO('2026-07-20', 3)).toBe('2026-07-23');
    expect(eachDateISO('2026-07-20', 3)).toEqual(['2026-07-20', '2026-07-21', '2026-07-22']);
    expect(weekdayOfDateISO('2026-07-20')).toBe(1); // Monday
    expect(weekdayOfDateISO('2026-07-19')).toBe(0); // Sunday
  });

  it('parses and formats time strings', () => {
    expect(toMinutes('08:30')).toBe(510);
    expect(toMinutes('08:30:00')).toBe(510);
    expect(minutesToHHMM(510)).toBe('08:30');
    expect(minutesToHHMM(0)).toBe('00:00');
  });
});
