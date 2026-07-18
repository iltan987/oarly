import { describe, expect, it } from 'vitest';

import { computeSeating } from './seating';

const at = (iso: string) => new Date(iso);
const reg = (id: string, iso: string) => ({ id, paymentType: 'regular' as const, effectiveAt: at(iso) });
const ms = (id: string, iso: string) => ({ id, paymentType: 'multisport' as const, effectiveAt: at(iso) });

describe('computeSeating', () => {
  it('seats the first `capacity` by arrival in equal mode; waitlists the rest with 1-based positions', () => {
    const out = computeSeating([reg('a', '2026-07-17T09:00:00Z'), reg('b', '2026-07-17T09:01:00Z'), reg('c', '2026-07-17T09:02:00Z')], 2, 'equal');
    expect(out).toEqual([
      { id: 'a', status: 'booked', queuePosition: null },
      { id: 'b', status: 'booked', queuePosition: null },
      { id: 'c', status: 'waitlisted', queuePosition: 1 },
    ]);
  });

  it('equal mode ignores payment type entirely (FCFS)', () => {
    const out = computeSeating([ms('a', '2026-07-17T09:00:00Z'), reg('b', '2026-07-17T09:01:00Z')], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('priority mode: a later regular outranks an earlier multisport (displacement)', () => {
    const out = computeSeating([ms('m', '2026-07-17T09:00:00Z'), reg('r', '2026-07-17T09:05:00Z')], 1, 'priority');
    expect(out.find((x) => x.id === 'r')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'm')!).toEqual({ id: 'm', status: 'waitlisted', queuePosition: 1 });
  });

  it('priority mode: within the same rank, earlier arrival wins', () => {
    const out = computeSeating([reg('r2', '2026-07-17T09:05:00Z'), reg('r1', '2026-07-17T09:00:00Z')], 1, 'priority');
    expect(out.find((x) => x.id === 'r1')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'r2')!.status).toBe('waitlisted');
  });

  it('breaks exact-time ties deterministically by id', () => {
    const t = '2026-07-17T09:00:00Z';
    const out = computeSeating([reg('b', t), reg('a', t)], 1, 'equal');
    expect(out.find((x) => x.id === 'a')!.status).toBe('booked');
    expect(out.find((x) => x.id === 'b')!.status).toBe('waitlisted');
  });

  it('returns an empty array for no entries and seats all when under capacity', () => {
    expect(computeSeating([], 4, 'equal')).toEqual([]);
    const out = computeSeating([reg('a', '2026-07-17T09:00:00Z')], 4, 'equal');
    expect(out).toEqual([{ id: 'a', status: 'booked', queuePosition: null }]);
  });
});
