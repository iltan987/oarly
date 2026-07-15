import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { boatTypes } from '@/db/schema/boats';

describe('boat_types schema', () => {
  it('carries seats, allowed_payment and optional min skill/attendance', () => {
    const cfg = getTableConfig(boatTypes);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['seats'].notNull).toBe(true);
    expect(cols['allowed_payment']).toBeDefined();
    expect(cols['min_skill_level_id'].notNull).toBe(false);
    expect(cols['min_attendance'].notNull).toBe(false);
  });
  it('references its club and (optionally) a skill level', () => {
    expect(getTableConfig(boatTypes).foreignKeys.length).toBe(2);
  });
});
