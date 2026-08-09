import { sql } from 'drizzle-orm';
import {
boolean, integer,   pgTable, text, timestamp, uniqueIndex,
uuid, } from 'drizzle-orm/pg-core';

import { user } from './auth';
import {
bookingOpenModeEnum,
  clubStatusEnum, headingFontEnum, membershipRoleEnum, membershipStatusEnum,
multisportModeEnum,   noshowPenaltyEnum, } from './enums';

export type ClubStatus = (typeof clubStatusEnum.enumValues)[number];

/**
 * The club statuses a slug is allowed to resolve to — every `club_status` except
 * `rejected`. It is the predicate of the partial unique index `clubs_slug_uq` AND the
 * filter every by-slug lookup must spell, and those two things have to be the SAME
 * text or the index is dead weight.
 *
 * ── Why the spelling is load-bearing, twice over ──
 *
 * 1. At MIGRATION time it must enumerate the survivors rather than say
 *    `<> 'rejected'`. `ALTER TYPE … ADD VALUE` and a use of that new value cannot
 *    share a transaction, and drizzle runs every pending migration in ONE — so the
 *    `<>` form commits on a fresh database (passing all of CI) and fails the
 *    production deploy with `unsafe use of new value "rejected"`.
 *
 * 2. At QUERY time every lookup must spell the filter the same way, because Postgres
 *    matches a query against a partial index by PROVING the query's predicate implies
 *    the index's. It cannot prove `status <> 'rejected'` implies
 *    `status IN ('pending','active','suspended')` — that would require knowing the
 *    enum is exhaustive, which the proof machinery does not. So the `<>` form is
 *    simply never eligible for `clubs_slug_uq`, and every by-slug resolution becomes a
 *    sequential scan over the whole `clubs` table. Measured on 35,533 clubs:
 *
 *      slug = $1 AND status <> 'rejected'    Seq Scan, 709 buffers, 1.589 ms
 *      slug = $1 AND status IN (…)           Index Scan, 3 buffers, 0.049 ms
 *
 *    `getClubBySlug` runs once per render of every `/s/[slug]/*` page and once per
 *    owner/member server action, so this is the hottest lookup in the product.
 *
 * DO NOT "simplify" a call site back to `ne(clubs.status, 'rejected')`. It is
 * semantically identical and operationally a full table scan.
 *
 * Derived from `clubStatusEnum` rather than written out, so a new `club_status` value
 * joins the list at all six lookup sites and in the index predicate at once, instead
 * of silently dropping out of one of them. `pnpm db:generate` then reports the index
 * as drifted, which is the visible prompt to decide whether the new status really is
 * slug-addressable.
 */
export const SLUG_ADDRESSABLE_STATUSES = clubStatusEnum.enumValues
  .filter((s): s is Exclude<ClubStatus, 'rejected'> => s !== 'rejected');

export const clubs = pgTable('clubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  tagline: text('tagline'),
  description: text('description'),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  status: clubStatusEnum('status').notNull().default('pending'),
  multisportMode: multisportModeEnum('multisport_mode').notNull().default('equal'),
  multisportEnabled: boolean('multisport_enabled').notNull().default(true),
  bookingOpenMode: bookingOpenModeEnum('booking_open_mode').notNull().default('always'),
  bookingOpenLeadDays: integer('booking_open_lead_days'),
  selfCancelEnabled: boolean('self_cancel_enabled').notNull().default(true),
  cancelCutoffHours: integer('cancel_cutoff_hours'),
  // How many members may queue behind a full session. null = unlimited (today's
  // behaviour). A club policy rather than a per-boat property, for the same
  // reason cancel_cutoff_hours is: it describes how much queue the club wants to
  // manage, not a physical fact about a hull.
  waitlistCapacity: integer('waitlist_capacity'),
  noshowPenalty: noshowPenaltyEnum('noshow_penalty').notNull().default('off'),
  openOnHolidays: boolean('open_on_holidays').notNull().default(false),
  brandAccent: text('brand_accent'),
  headingFont: headingFontEnum('heading_font').notNull().default('default'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  // Who decided this club request, when, and why. `review_note` is required when
  // rejecting (enforced in `decideClubRequest`) and optional when approving.
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'set null' }),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // Partial, not a plain UNIQUE: a rejected request must not hold its slug hostage,
  // or one spam request permanently burns a real club's name (spec §5.2).
  //
  // The predicate is built from `SLUG_ADDRESSABLE_STATUSES` so it cannot drift away
  // from the filter the lookups spell — see the constant for why both halves must
  // enumerate the survivors rather than say `<> 'rejected'`. `sql.raw` because these
  // are index-definition literals, not bound parameters: an index predicate has
  // nowhere to bind a parameter, and the values come from the enum declaration, never
  // from input.
  uniqueIndex('clubs_slug_uq').on(t.slug)
    .where(sql`${t.status} IN (${sql.raw(SLUG_ADDRESSABLE_STATUSES.map((s) => `'${s}'`).join(', '))})`),
]);

export const clubSocials = pgTable('club_socials', {
  id: uuid('id').defaultRandom().primaryKey(),
  clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  handle: text('handle').notNull(),
});

export const skillLevels = pgTable(
  'skill_levels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rank: integer('rank').notNull(),
  },
  (t) => [uniqueIndex('skill_levels_club_rank_uq').on(t.clubId, t.rank)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id').notNull().references(() => clubs.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    status: membershipStatusEnum('status').notNull().default('pending'),
    bannedUntil: timestamp('banned_until', { withTimezone: true }),
    skillLevelId: uuid('skill_level_id').references(() => skillLevels.id, { onDelete: 'set null' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('memberships_user_club_uq').on(t.userId, t.clubId)],
);
