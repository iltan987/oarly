import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { clubs, memberships, skillLevels } from '@/db/schema/clubs';

describe('clubs schema', () => {
  it('clubs has a unique slug and policy columns', () => {
    const cfg = getTableConfig(clubs);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    expect(cols['slug'].isUnique).toBe(true);
    for (const name of ['multisport_mode', 'booking_open_mode', 'noshow_penalty', 'brand_accent', 'timezone', 'tagline', 'description']) {
      expect(cols[name]).toBeDefined();
    }
  });

  it('memberships enforce one row per (user, club)', () => {
    const cfg = getTableConfig(memberships);
    const uq = cfg.indexes.find((i) => i.config.unique);
    expect(uq).toBeDefined();
    expect(uq!.config.columns.map((c) => (c as { name: string }).name).sort()).toEqual(['club_id', 'user_id']);
  });

  it('skill levels order by rank within a club', () => {
    const cols = getTableConfig(skillLevels).columns.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['club_id', 'name', 'rank']));
  });
});
