import { describe, expect, it } from 'vitest';

import { resolveSeating } from './seating';

const b = (id: string, iso: string, pt: 'regular' | 'multisport' = 'regular') =>
  ({ id, status: 'booked' as const, paymentType: pt, effectiveAt: new Date(iso) });
const w = (id: string, iso: string, pt: 'regular' | 'multisport' = 'regular') =>
  ({ id, status: 'waitlisted' as const, paymentType: pt, effectiveAt: new Date(iso) });

describe('resolveSeating', () => {
  it('keeps a seated member seated — a later regular does NOT displace an earlier multisport (priority mode)', () => {
    const out = resolveSeating([b('m', '2026-07-17T09:00:00Z', 'multisport'), w('r', '2026-07-17T09:05:00Z', 'regular')], 1, 'priority');
    expect(out).toContainEqual({ id: 'm', status: 'booked', queuePosition: null });
    expect(out).toContainEqual({ id: 'r', status: 'waitlisted', queuePosition: 1 });
  });

  it('never demotes a seated booking even if over capacity (defensive)', () => {
    const out = resolveSeating([b('a', '2026-07-17T09:00:00Z'), b('b', '2026-07-17T09:01:00Z')], 1, 'equal');
    expect(out.every((x) => x.status === 'booked')).toBe(true);
  });

  it('fills a free seat from the waitlist by priority order (priority mode: regular promoted before earlier multisport)', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('m', '2026-07-17T09:01:00Z', 'multisport'), w('r', '2026-07-17T09:02:00Z', 'regular')], 2, 'priority');
    expect(out.find((x) => x.id === 's')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'r')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 1 });
  });

  it('fills a free seat FIFO in equal mode (earliest waiter promoted)', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('e', '2026-07-17T09:02:00Z'), w('d', '2026-07-17T09:01:00Z')], 2, 'equal');
    expect(out.find((x) => x.id === 'd')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'e')!).toEqual({ id: 'e', status: 'waitlisted', queuePosition: 1 });
  });

  it('leaves the waitlist untouched when the session is full', () => {
    const out = resolveSeating([b('a', '2026-07-17T09:00:00Z'), b('b', '2026-07-17T09:01:00Z'), w('c', '2026-07-17T09:02:00Z')], 2, 'equal');
    expect(out.filter((x) => x.status === 'booked').map((x) => x.id).sort()).toEqual(['a', 'b']);
    expect(out.find((x) => x.id === 'c')!).toEqual({ id: 'c', status: 'waitlisted', queuePosition: 1 });
  });

  it('numbers a longer waitlist 1-based in priority order', () => {
    const out = resolveSeating([b('s', '2026-07-17T09:00:00Z'), w('m', '2026-07-17T09:01:00Z', 'multisport'), w('r', '2026-07-17T09:03:00Z', 'regular')], 1, 'priority');
    // no free seat (1 booked, capacity 1); regular (rank 0) ranks ahead of multisport
    expect(out.find((x) => x.id === 'r')!).toEqual({ id: 'r', status: 'waitlisted', queuePosition: 1 });
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 2 });
  });

  it('breaks exact-time ties deterministically by id', () => {
    const t = '2026-07-17T09:00:00Z';
    const out = resolveSeating([w('b', t), w('a', t)], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('returns an empty array for no entries and seats all when under capacity', () => {
    expect(resolveSeating([], 4, 'equal')).toEqual([]);
    expect(resolveSeating([w('a', '2026-07-17T09:00:00Z')], 4, 'equal')).toEqual([{ id: 'a', status: 'booked', queuePosition: null }]);
  });
});
