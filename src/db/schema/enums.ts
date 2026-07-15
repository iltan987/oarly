import { pgEnum } from 'drizzle-orm/pg-core';

export const paymentTypeEnum = pgEnum('payment_type', ['regular', 'multisport']);
export const clubStatusEnum = pgEnum('club_status', ['pending', 'active', 'suspended']);
export const multisportModeEnum = pgEnum('multisport_mode', ['equal', 'priority']);
export const bookingOpenModeEnum = pgEnum('booking_open_mode', ['always', 'lead']);
export const noshowPenaltyEnum = pgEnum('noshow_penalty', ['off', '2d', '1w', '2w', '1m', 'never']);
export const headingFontEnum = pgEnum('heading_font', ['default', 'premium']);
export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member']);
export const membershipStatusEnum = pgEnum('membership_status', ['pending', 'approved', 'rejected', 'banned']);
export const allowedPaymentEnum = pgEnum('allowed_payment', ['regular_only', 'multisport_only', 'both']);
export const slotStatusEnum = pgEnum('slot_status', ['scheduled', 'open', 'closed', 'cancelled']);
export const sessionStatusEnum = pgEnum('session_status', ['open', 'closed', 'cancelled']);
export const bookingStatusEnum = pgEnum('booking_status', ['booked', 'waitlisted', 'cancelled', 'no_show', 'attended']);
export const bookingSourceEnum = pgEnum('booking_source', ['member', 'owner', 'admin_prereservation']);
export const holidaySourceEnum = pgEnum('holiday_source', ['auto', 'manual']);
export const holidayStatusEnum = pgEnum('holiday_status', ['pending', 'approved']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'booking_confirmation', 'waitlist_promotion', 'displaced', 'cancellation', 'reminder',
]);
