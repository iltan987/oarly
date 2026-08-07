import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './pg-errors';

describe('isUniqueViolation', () => {
  it('matches a bare pg error', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'bookings_multisport_day_uq' }, 'bookings_multisport_day_uq')).toBe(true);
  });

  it('matches through a wrapper error cause chain', () => {
    // Drizzle wraps driver errors, so the pg error is reachable only via `cause`.
    const wrapped = new Error('query failed', { cause: { code: '23505', constraint: 'bookings_multisport_day_uq' } });
    expect(isUniqueViolation(wrapped, 'bookings_multisport_day_uq')).toBe(true);
  });

  it('rejects a different constraint', () => {
    expect(isUniqueViolation({ code: '23505', constraint: 'bookings_active_uq' }, 'bookings_multisport_day_uq')).toBe(false);
  });

  it('rejects a different error code and non-errors', () => {
    expect(isUniqueViolation({ code: '23503', constraint: 'bookings_multisport_day_uq' }, 'bookings_multisport_day_uq')).toBe(false);
    expect(isUniqueViolation(null, 'bookings_multisport_day_uq')).toBe(false);
    expect(isUniqueViolation('boom', 'bookings_multisport_day_uq')).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    const loop: { cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop, 'x')).toBe(false);
  });
});
