import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { clubs, memberships, skillLevels } from '@/db/schema/clubs';

describe('clubs schema', () => {
  it('clubs has policy columns and a slug unique only among non-rejected rows', () => {
    const cfg = getTableConfig(clubs);
    const cols = Object.fromEntries(cfg.columns.map((c) => [c.name, c]));
    for (const name of ['multisport_mode', 'booking_open_mode', 'noshow_penalty', 'brand_accent', 'timezone', 'tagline', 'description']) {
      expect(cols[name]).toBeDefined();
    }

    // Slug uniqueness is a PARTIAL index, not a column-level UNIQUE: a rejected club
    // request must not hold its slug hostage (spec §5.2), so rejected rows are exempt.
    expect(cols['slug'].isUnique).toBe(false);
    const slugUq = cfg.indexes.find((i) => i.config.name === 'clubs_slug_uq');
    expect(slugUq).toBeDefined();
    expect(slugUq!.config.unique).toBe(true);
    expect(slugUq!.config.columns.map((c) => (c as { name: string }).name)).toEqual(['slug']);
    // The predicate must enumerate the surviving statuses. `<> 'rejected'` would use an
    // enum value in the same transaction that added it, which Postgres forbids — it
    // commits on a fresh DB and breaks the production deploy. See the migration comment.
    expect(slugUq!.config.where).toBeDefined();
  });

  it('defaults multisport_enabled to true so existing clubs are unaffected', () => {
    const cols = Object.fromEntries(getTableConfig(clubs).columns.map((c) => [c.name, c]));
    expect(cols['multisport_enabled']).toBeDefined();
    expect(cols['multisport_enabled'].notNull).toBe(true);
    expect(cols['multisport_enabled'].default).toBe(true);
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

  it('carries an optional waitlist capacity', () => {
    const cols = Object.fromEntries(getTableConfig(clubs).columns.map((c) => [c.name, c]));
    expect(cols['waitlist_capacity']).toBeDefined();
    // Nullable on purpose: null means "unlimited", which is exactly the behaviour
    // every existing club has today, so the column changes nothing until an owner
    // sets a number.
    expect(cols['waitlist_capacity'].notNull).toBe(false);
  });
});
