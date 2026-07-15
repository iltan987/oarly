import {
  pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  clubStatusEnum, multisportModeEnum, bookingOpenModeEnum,
  noshowPenaltyEnum, headingFontEnum, membershipRoleEnum, membershipStatusEnum,
} from './enums';

export const clubs = pgTable('clubs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  phone: text('phone'),
  timezone: text('timezone').notNull().default('Europe/Istanbul'),
  status: clubStatusEnum('status').notNull().default('pending'),
  multisportMode: multisportModeEnum('multisport_mode').notNull().default('equal'),
  bookingOpenMode: bookingOpenModeEnum('booking_open_mode').notNull().default('always'),
  bookingOpenLeadDays: integer('booking_open_lead_days'),
  selfCancelEnabled: boolean('self_cancel_enabled').notNull().default(true),
  cancelCutoffHours: integer('cancel_cutoff_hours'),
  noshowPenalty: noshowPenaltyEnum('noshow_penalty').notNull().default('off'),
  openOnHolidays: boolean('open_on_holidays').notNull().default(false),
  brandAccent: text('brand_accent'),
  headingFont: headingFontEnum('heading_font').notNull().default('default'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
