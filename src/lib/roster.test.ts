import { describe, expect, it } from 'vitest';

import { type CountableSession, rosterDayTotals } from './roster';

/**
 * The day's totals used to be written out twice — once on `/manage` and once nowhere,
 * which is how `/manage/bookings` came to show no numbers at all. Lifting them here is
 * only worth doing if the ONE rule they encode is pinned, so that is what this file is
 * about: `seated` is a count of `status === 'booked'`, not a length of the seated array.
 */
function session(over: Partial<CountableSession> = {}): CountableSession {
  return { capacity: 4, seated: [], waitlisted: [], ...over };
}

const booked = (bookingId: string): CountableSession['seated'][number] => ({
  bookingId, name: bookingId, paymentType: 'regular', queuePosition: null, status: 'booked',
});
const noShow = (bookingId: string): CountableSession['seated'][number] => ({
  bookingId, name: bookingId, paymentType: 'regular', queuePosition: null, status: 'no_show',
});
const waiting = (bookingId: string, queuePosition: number): CountableSession['waitlisted'][number] => ({
  bookingId, name: bookingId, paymentType: 'regular', queuePosition, status: 'waitlisted',
});

describe('rosterDayTotals', () => {
  it('sums seats, waiters and capacity across every session of the day', () => {
    expect(rosterDayTotals([
      session({ capacity: 8, seated: [booked('a'), booked('b')], waitlisted: [waiting('w1', 1)] }),
      session({ capacity: 12, seated: [booked('c')], waitlisted: [waiting('w2', 1), waiting('w3', 2)] }),
    ])).toEqual({ seated: 3, waitlisted: 3, capacity: 20 });
  });

  /**
   * THE case, and the reason this is a function rather than a `.length`.
   *
   * `getDayRoster` puts `no_show` rows in `seated` on purpose — the owner has to see the
   * mark to be able to undo it — so `seated.length` counts a member who did not turn up
   * as holding a seat. That overstates a session that had an absence, and it contradicts
   * `freeSeats`, which filters on `status === 'booked'` and is simultaneously offering
   * that seat to the add form: 4/4 full beside a form that will happily seat a fifth.
   *
   * Deliberate break: change the filter to `s.seated.length` and this is the assertion
   * that fails (3 rather than 2).
   */
  it('does not count a no-show as a held seat', () => {
    expect(rosterDayTotals([
      session({ capacity: 4, seated: [booked('a'), noShow('b'), booked('c')] }),
    ])).toEqual({ seated: 2, waitlisted: 0, capacity: 4 });
  });

  // A whole session of absences reads as empty, not as full — the same rule at its limit,
  // where an off-by-one filter is easiest to mistake for a rounding difference.
  it('reports a session where nobody turned up as empty', () => {
    expect(rosterDayTotals([session({ capacity: 2, seated: [noShow('a'), noShow('b')] })]))
      .toEqual({ seated: 0, waitlisted: 0, capacity: 2 });
  });

  // The empty day: `/manage/bookings` decides whether to render the numbers at all from
  // `sessions.length`, but a closed day still calls this.
  it('returns zeroes for a day with no sessions', () => {
    expect(rosterDayTotals([])).toEqual({ seated: 0, waitlisted: 0, capacity: 0 });
  });

  /**
   * The waitlist gets NO status filter, and that is deliberate rather than an oversight:
   * `getDayRoster` routes a row into `waitlisted` only when its status is `waitlisted`,
   * so filtering here would be a second copy of a rule that is already enforced at the
   * bucket. This fixture is the shape that would make a copied filter visible if one were
   * ever added with the wrong status.
   */
  it('counts every waitlisted row, since only waitlisted rows reach that bucket', () => {
    expect(rosterDayTotals([session({ waitlisted: [waiting('w1', 1), waiting('w2', 2), waiting('w3', 3)] })]).waitlisted)
      .toBe(3);
  });
});
