export type SeatAssignment = { id: string; status: 'booked' | 'waitlisted'; queuePosition: number | null };

/**
 * The single deterministic §9 seating decision for ONE session. Given the active
 * bookings (booked|waitlisted), the session capacity, and the club's MultiSport mode,
 * returns each booking's resolved status + waitlist position. Pure — no DB, no time source.
 * Order: (priorityRank asc, effectiveAt asc, id asc). priorityRank = 1 only for a MultiSport
 * booking in `priority` mode, else 0. Top `capacity` are seated; the remainder are waitlisted
 * with 1-based positions in the same order.
 */
export function computeSeating(
  entries: { id: string; paymentType: 'regular' | 'multisport'; effectiveAt: Date }[],
  capacity: number,
  mode: 'equal' | 'priority',
): SeatAssignment[] {
  const rankOf = (p: 'regular' | 'multisport') => (mode === 'priority' && p === 'multisport' ? 1 : 0);
  const sorted = [...entries].sort((a, b) => {
    const ra = rankOf(a.paymentType);
    const rb = rankOf(b.paymentType);
    if (ra !== rb) return ra - rb;
    const ta = a.effectiveAt.getTime();
    const tb = b.effectiveAt.getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  let waitlist = 0;
  return sorted.map((e, i) =>
    i < capacity
      ? { id: e.id, status: 'booked' as const, queuePosition: null }
      : { id: e.id, status: 'waitlisted' as const, queuePosition: ++waitlist },
  );
}
