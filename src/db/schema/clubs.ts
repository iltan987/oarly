import { sql } from 'drizzle-orm';
import {
boolean, integer,   pgTable, text, timestamp, uniqueIndex,
uuid, } from 'drizzle-orm/pg-core';

import { user } from './auth';
import {
bookingOpenModeEnum,
  clubStatusEnum, headingFontEnum, membershipRoleEnum, membershipStatusEnum,
multisportModeEnum,   noshowPenaltyEnum, } from './enums';

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
  // The predicate lists the surviving statuses instead of `<> 'rejected'` because
  // `ALTER TYPE … ADD VALUE` and a use of that value cannot share a transaction, and
  // drizzle runs every pending migration in ONE transaction. `<> 'rejected'` passes on
  // a fresh DB and fails on an already-migrated one.
  uniqueIndex('clubs_slug_uq').on(t.slug).where(sql`${t.status} IN ('pending', 'active', 'suspended')`),
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
