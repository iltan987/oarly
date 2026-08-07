import { describe, expect, it } from 'vitest';

import { zonedWallClockToUtc } from './date-tz';
import { penaltyEndsAt, resolveBan } from './penalty';

const TZ = 'Europe/Istanbul';

describe('penaltyEndsAt', () => {
  it('returns null when the club does not penalise no-shows', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: 'off' })).toBeNull();
  });

  it('returns the permanent marker for a never policy', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: 'never' })).toBe('permanent');
  });

  it('anchors the ban to the session, not to now', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    const end = penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1w' });
    expect(end).toEqual(zonedWallClockToUtc('2026-03-17', '07:00', TZ));
  });

  it('adds each duration as calendar time', () => {
    const start = zonedWallClockToUtc('2026-03-10', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '2d' })).toEqual(zonedWallClockToUtc('2026-03-12', '07:00', TZ));
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '2w' })).toEqual(zonedWallClockToUtc('2026-03-24', '07:00', TZ));
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1m' })).toEqual(zonedWallClockToUtc('2026-04-10', '07:00', TZ));
  });

  it('keeps the wall-clock hour across a DST transition', () => {
    // Europe/London moves to BST on 2026-03-29. A 07:00 session a week earlier
    // must end at 07:00 local, not 06:00 — so the maths cannot be `+ 7 * 24h`.
    const LON = 'Europe/London';
    const start = zonedWallClockToUtc('2026-03-25', '07:00', LON);
    const end = penaltyEndsAt({ sessionStartAt: start, timezone: LON, policy: '1w' }) as Date;
    expect(end).toEqual(zonedWallClockToUtc('2026-04-01', '07:00', LON));
    expect(end.getTime() - start.getTime()).not.toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('clamps a month-end date rather than rolling into the next month', () => {
    const start = zonedWallClockToUtc('2026-01-31', '07:00', TZ);
    expect(penaltyEndsAt({ sessionStartAt: start, timezone: TZ, policy: '1m' })).toEqual(zonedWallClockToUtc('2026-02-28', '07:00', TZ));
  });
});

describe('resolveBan', () => {
  it('is empty for no penalties', () => {
    expect(resolveBan([])).toEqual({ bannedUntil: null, permanent: false });
  });

  it('ignores rows with no ban (an off-policy record)', () => {
    expect(resolveBan([{ bannedUntil: null, permanent: false }])).toEqual({ bannedUntil: null, permanent: false });
  });

  it('takes the latest end date and is order-independent', () => {
    const a = new Date('2026-03-17T04:00:00Z');
    const b = new Date('2026-03-19T04:00:00Z');
    expect(resolveBan([{ bannedUntil: a, permanent: false }, { bannedUntil: b, permanent: false }])).toEqual({ bannedUntil: b, permanent: false });
    expect(resolveBan([{ bannedUntil: b, permanent: false }, { bannedUntil: a, permanent: false }])).toEqual({ bannedUntil: b, permanent: false });
  });

  it('reports permanent when any row is permanent, whatever the dates say', () => {
    const a = new Date('2026-03-17T04:00:00Z');
    expect(resolveBan([{ bannedUntil: a, permanent: false }, { bannedUntil: null, permanent: true }]))
      .toEqual({ bannedUntil: a, permanent: true });
  });
});
