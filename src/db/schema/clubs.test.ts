import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { clubs, memberships, skillLevels, SLUG_ADDRESSABLE_STATUSES } from '@/db/schema/clubs';
import { clubStatusEnum } from '@/db/schema/enums';

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
    // The predicate must ENUMERATE the surviving statuses rather than say
    // `<> 'rejected'`. `ALTER TYPE … ADD VALUE` and a use of that new value cannot share
    // a transaction, and drizzle runs every pending migration in one — so the `<>` form
    // commits on a fresh DB (passing all of CI) and breaks the production deploy with
    // `unsafe use of new value "rejected"`. Asserting on the rendered SQL, because
    // `toBeDefined()` alone would happily accept the forbidden form.
    expect(slugUq!.config.where).toBeDefined();
    const predicate = new PgDialect().sqlToQuery(slugUq!.config.where!).sql;
    expect(predicate).not.toMatch(/rejected/);
    for (const status of ['pending', 'active', 'suspended']) {
      expect(predicate).toContain(`'${status}'`);
    }
  });

  it('builds the slug predicate from SLUG_ADDRESSABLE_STATUSES, which covers every non-rejected status', () => {
    // The constant is the single source the six by-slug lookups bind into `IN (…)`.
    // If it ever stops matching the index predicate, Postgres can no longer prove the
    // implication and every by-slug resolution silently becomes a sequential scan —
    // a performance cliff with no functional symptom, which is why it is asserted here
    // rather than left to be noticed.
    expect(SLUG_ADDRESSABLE_STATUSES).toEqual(clubStatusEnum.enumValues.filter((s) => s !== 'rejected'));
    expect(SLUG_ADDRESSABLE_STATUSES).not.toContain('rejected');

    const slugUq = getTableConfig(clubs).indexes.find((i) => i.config.name === 'clubs_slug_uq');
    const predicate = new PgDialect().sqlToQuery(slugUq!.config.where!).sql;
    // Rendered from the constant, in order, with nothing else in the list.
    expect(predicate).toBe(
      `"clubs"."status" IN (${SLUG_ADDRESSABLE_STATUSES.map((s) => `'${s}'`).join(', ')})`,
    );
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
