import type { RestrictionState } from './restriction';

/**
 * Which of the club page's mutually exclusive calls to action a viewer gets.
 *
 * `anonymous` covers "no membership row", signed in or not — the door is the same.
 */
export type ViewerKind = 'anonymous' | 'restricted' | 'owner' | 'pending' | 'rejected' | 'member';

/**
 * Precedence: `anonymous` → suspended → `rejected` → paused → `owner` → `pending` →
 * `member`.
 *
 * Two of those positions were argued for; the rest fall out.
 *
 * ## `restricted` sits ABOVE `owner`
 *
 * Today a banned owner reaches the ban branch only as a SIDE EFFECT: the owner
 * branch happens to require `status === 'approved'`, and a permanent penalty sets
 * `status = 'banned'`, so the owner test falls through. That is an accident, not a
 * decision — the two conditions are coupled by nothing. The moment someone relaxes
 * the owner branch (to admit a `pending` owner during onboarding, say, which is a
 * perfectly reasonable future change), a suspended owner silently gets the Manage
 * button back. Making the precedence explicit means that change cannot do that.
 *
 * The owner test still requires `approved` as well; the point is that the ban is
 * now checked FIRST rather than relying on that condition to do two jobs.
 *
 * ## `rejected` sits ABOVE a PAUSE, and below a suspension
 *
 * An owner can reject an application from someone who is already serving a timed
 * penalty. `restrictionState` reports that row as `paused` (it only reads `status`
 * for the `banned` case), while `checkEligibility` calls the very same row
 * `not_approved` — so leading with the restriction would tell a rejected applicant
 * *"you're paused until 12 August, you can book again then"*, which is simply false:
 * the date arrives and they still cannot book, because they are not a member.
 *
 * Fixed here in the PRECEDENCE rather than in `restrictionState`, which is
 * deliberately the same predicate as the eligibility gate and must stay that way.
 *
 * A suspension still outranks `rejected`. In practice the pair is unreachable —
 * `status` is one column, so a row cannot be both `rejected` and `banned` — but if a
 * caller ever passes that combination, "your access is suspended" is the more serious
 * of the two claims and the one that must not be swallowed.
 */
export function viewerKindOf(input: {
  membership: { role: string; status: string } | null;
  restriction: RestrictionState;
}): ViewerKind {
  if (!input.membership) return 'anonymous';
  if (input.restriction === 'suspended') return 'restricted';
  if (input.membership.status === 'rejected') return 'rejected';
  if (input.restriction !== 'none') return 'restricted';
  if (input.membership.role === 'owner' && input.membership.status === 'approved') return 'owner';
  if (input.membership.status === 'pending') return 'pending';
  return 'member';
}
