import type { RestrictionState } from './restriction';

/**
 * Which of the club page's mutually exclusive calls to action a viewer gets.
 *
 * `anonymous` covers "no membership row", signed in or not — the door is the same.
 */
export type ViewerKind = 'anonymous' | 'restricted' | 'owner' | 'pending' | 'rejected' | 'member';

/**
 * Precedence: `anonymous` → `restricted` → `owner` → `pending` → `rejected` → `member`.
 *
 * `restricted` sits ABOVE `owner` deliberately, and that is the only ordering
 * decision here worth arguing about.
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
 */
export function viewerKindOf(input: {
  membership: { role: string; status: string } | null;
  restriction: RestrictionState;
}): ViewerKind {
  if (!input.membership) return 'anonymous';
  if (input.restriction !== 'none') return 'restricted';
  if (input.membership.role === 'owner' && input.membership.status === 'approved') return 'owner';
  if (input.membership.status === 'pending') return 'pending';
  if (input.membership.status === 'rejected') return 'rejected';
  return 'member';
}
