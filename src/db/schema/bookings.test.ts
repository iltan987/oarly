import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { bookings, penalties } from '@/db/schema/bookings';

describe('bookings schema', () => {
  const cfg = getTableConfig(bookings);

  it('allows guest bookings (nullable user_id) and records payment/source', () => {
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['user_id'].notNull).toBe(false);
    expect(cols['payment_type'].notNull).toBe(true);
    expect(cols['effective_at'].notNull).toBe(true);
    expect(cols['hidden']).toBeDefined();
    expect(cols['source']).toBeDefined();
  });

  it('has an active-status partial unique index on (session_id, user_id)', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'bookings_active_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.where).toBeDefined();
    expect(idx!.config.columns.map((c: any) => c.name).sort()).toEqual(['session_id', 'user_id']);
  });

  it('has an idempotency partial unique index', () => {
    const idx = cfg.indexes.find((i) => i.config.name === 'bookings_idem_uq');
    expect(idx).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.where).toBeDefined();
  });

  it('penalties link a membership and record ban expiry', () => {
    const cols = getTableConfig(penalties).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['membership_id', 'reason', 'banned_until']));
  });
});
