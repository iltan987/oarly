export type EligibilityReason = 'not_approved' | 'banned' | 'skill_too_low' | 'payment_not_allowed';
export type EligibilityResult = { ok: true } | { ok: false; reason: EligibilityReason };

/**
 * The §7 booking-time gate: a member may take a seat only if all hold —
 * (1) membership is `approved` and not currently banned,
 * (2) member skill rank ≥ the boat's minimum (higher rank = more advanced),
 * (3) the chosen payment type is permitted by the boat's allow-list.
 * Pure; rules evaluated in this order so the first failure is the reason returned.
 */
export function checkEligibility(input: {
  membershipStatus: 'pending' | 'approved' | 'rejected' | 'banned' | null;
  bannedUntil: Date | null;
  memberSkillRank: number | null;
  boatMinSkillRank: number | null;
  boatAllowedPayment: 'regular_only' | 'multisport_only' | 'both';
  paymentType: 'regular' | 'multisport';
  now: Date;
}): EligibilityResult {
  if (input.membershipStatus !== 'approved') return { ok: false, reason: 'not_approved' };
  if (input.bannedUntil && input.bannedUntil.getTime() > input.now.getTime()) return { ok: false, reason: 'banned' };
  if (input.boatMinSkillRank != null) {
    if (input.memberSkillRank == null || input.memberSkillRank < input.boatMinSkillRank) {
      return { ok: false, reason: 'skill_too_low' };
    }
  }
  if (input.boatAllowedPayment === 'regular_only' && input.paymentType !== 'regular') return { ok: false, reason: 'payment_not_allowed' };
  if (input.boatAllowedPayment === 'multisport_only' && input.paymentType !== 'multisport') return { ok: false, reason: 'payment_not_allowed' };
  return { ok: true };
}
