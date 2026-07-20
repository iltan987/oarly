export type SeatEntry = { id: string; status: 'booked' | 'waitlisted'; paymentType: 'regular' | 'multisport'; effectiveAt: Date };
export type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null };

/**
 * Sticky §9 seating for ONE session. Given the session's active bookings WITH
 * their current status, the capacity, and the club's MultiSport mode, returns
 * each booking's resolved status + waitlist position.
 *
 * Rule: a currently-`booked` booking is NEVER demoted. Any free seats
 * (capacity − #booked) are filled from the `waitlisted` pool ordered by
 * (priorityRank asc, effectiveAt asc, id asc); the remainder are waitlisted with
 * 1-based positions in that same order. priorityRank = 1 only for a MultiSport
 * booking in `priority` mode, else 0 (so regular ranks ahead of multisport).
 * Pure — no DB, no time source.
 */
export function resolveSeating(entries: SeatEntry[], capacity: number, mode: 'equal' | 'priority'): SeatAssignment[] {
  const rankOf = (p: 'regular' | 'multisport') => (mode === 'priority' && p === 'multisport' ? 1 : 0);
  const byPriority = (a: SeatEntry, b: SeatEntry) => {
    const ra = rankOf(a.paymentType);
    const rb = rankOf(b.paymentType);
    if (ra !== rb) return ra - rb;
    const ta = a.effectiveAt.getTime();
    const tb = b.effectiveAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  const seated = entries.filter((e) => e.status === 'booked');
  const waitPool = entries.filter((e) => e.status === 'waitlisted').sort(byPriority);
  const freeSeats = Math.max(0, capacity - seated.length);

  const promoted = waitPool.slice(0, freeSeats);
  const stayWaiting = waitPool.slice(freeSeats);

  return [
    ...seated.map((e) => ({ id: e.id, status: 'booked' as const, queuePosition: null })),
    ...promoted.map((e) => ({ id: e.id, status: 'booked' as const, queuePosition: null })),
    ...stayWaiting.map((e, i) => ({ id: e.id, status: 'waitlisted' as const, queuePosition: i + 1 })),
  ];
}
