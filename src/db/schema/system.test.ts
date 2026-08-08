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

  // The keyset cursor of /admin/audit is `{ createdAt: Date; id }`, and a JS Date
  // holds milliseconds. At the Postgres default (microseconds) the cursor of a row
  // written at …748926 came back as …748, and every row in between was excluded
  // from the next page forever — silent loss, no duplicates, invisible to any test
  // whose rows land in different milliseconds. Asserted here because the failure is
  // a missing THREE in a column definition that otherwise looks perfectly normal.
  it('audit_log timestamps are millisecond-precise, matching the keyset cursor', () => {
    const createdAt = getTableConfig(auditLog).columns.find((c) => c.name === 'created_at');
    expect((createdAt as unknown as { precision?: number }).precision).toBe(3);
  });

  // Both indexes must be DESC NULLS FIRST, because that is what a bare
  // `ORDER BY created_at DESC, id DESC` means in Postgres. Drizzle's `.desc()`
  // alone emits DESC NULLS LAST, which does not match, and a mismatched index is
  // not used for ordering: the planner puts a Sort over the whole scan and the
  // index buys nothing. The club-leading index is the one Task 8's club detail page
  // depends on — without it `club_id` is a post-index Filter, so a low-volume club's
  // page walks the log from the head until it accumulates a full page of matches.
  it.each([
    ['audit_log_created_at_id_idx', ['created_at', 'id']],
    ['audit_log_club_created_at_id_idx', ['club_id', 'created_at', 'id']],
  ])('%s is ordered to serve the keyset page', (name, columns) => {
    const idx = getTableConfig(auditLog).indexes.find((i) => i.config.name === name);
    expect(idx).toBeDefined();
    const cols = idx!.config.columns as { name: string; indexConfig?: { order?: string; nulls?: string } }[];
    expect(cols.map((c) => c.name)).toEqual(columns);
    for (const c of cols.filter((c) => c.name !== 'club_id')) {
      expect([c.name, c.indexConfig?.order, c.indexConfig?.nulls]).toEqual([c.name, 'desc', 'first']);
    }
  });
});
