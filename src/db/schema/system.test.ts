import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { clubHolidayOverrides, holidays } from '@/db/schema/holidays';
import { auditLog, notifications } from '@/db/schema/system';

describe('holidays & system schema', () => {
  it('holidays record source and approval status', () => {
    const cols = getTableConfig(holidays).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['date', 'name', 'source', 'status', 'year']));
  });
  it('overrides are unique per (club, date)', () => {
    const uq = getTableConfig(clubHolidayOverrides).indexes.find((i) => i.config.unique);
    expect(uq).toBeDefined();
    expect(uq!.config.columns.map((c) => (c as { name: string }).name).sort()).toEqual(['club_id', 'date']);
  });
  it('notifications are unique per (user, type, session) for idempotency', () => {
    const uq = getTableConfig(notifications).indexes.find((i) => i.config.name === 'notifications_idem_uq');
    expect(uq).toBeDefined();
    expect(uq!.config.unique).toBe(true);
  });
  it('audit_log records the acting role', () => {
    const cols = getTableConfig(auditLog).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['actor_user_id', 'acting_as_role', 'action']));
  });
});
