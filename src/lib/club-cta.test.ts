import { describe, expect, it } from 'vitest';

import { viewerKindOf } from './club-cta';

describe('viewerKindOf', () => {
  it('is anonymous when there is no membership row', () => {
    expect(viewerKindOf({ membership: null, restriction: 'none' })).toBe('anonymous');
  });

  /**
   * `anonymous` outranks `restricted` because a null membership cannot BE restricted;
   * a caller that passed a stale restriction alongside a deleted membership must still
   * get the join door, not a suspension notice for a club they no longer belong to.
   */
  it('is anonymous even if a stale restriction is passed alongside a null membership', () => {
    expect(viewerKindOf({ membership: null, restriction: 'suspended' })).toBe('anonymous');
  });

  it('is owner for an approved owner', () => {
    expect(viewerKindOf({ membership: { role: 'owner', status: 'approved' }, restriction: 'none' })).toBe('owner');
  });

  it('is pending for a membership awaiting approval', () => {
    expect(viewerKindOf({ membership: { role: 'member', status: 'pending' }, restriction: 'none' })).toBe('pending');
  });

  it('is rejected for a rejected membership', () => {
    expect(viewerKindOf({ membership: { role: 'member', status: 'rejected' }, restriction: 'none' })).toBe('rejected');
  });

  it('is member for an approved member', () => {
    expect(viewerKindOf({ membership: { role: 'member', status: 'approved' }, restriction: 'none' })).toBe('member');
  });

  it('is restricted for an approved member serving a timed pause', () => {
    expect(viewerKindOf({ membership: { role: 'member', status: 'approved' }, restriction: 'paused' })).toBe('restricted');
  });

  /**
   * THE precedence test. A suspended owner must NOT get the Manage button.
   *
   * Today this passes for two independent reasons — the ban check comes first, AND the
   * owner check requires `status === 'approved'` which a permanent penalty removes. The
   * second reason is an accident of coupling. Relax the owner branch to admit, say, a
   * pending owner during onboarding and the accidental protection disappears; this test
   * is what stops that change from quietly handing an expelled owner their club back.
   */
  it('is restricted, not owner, for a suspended owner', () => {
    expect(viewerKindOf({ membership: { role: 'owner', status: 'banned' }, restriction: 'suspended' })).toBe('restricted');
  });

  /**
   * The mutation the test above cannot kill on its own: an owner who is still `approved`
   * (a TIMED pause leaves status alone — `recomputeBan` only writes 'banned' for permanent
   * rows) but currently paused. Reorder `restricted` below `owner` and this one flips to
   * 'owner' while every other case in this file still passes.
   */
  it('is restricted, not owner, for an approved owner serving a timed pause', () => {
    expect(viewerKindOf({ membership: { role: 'owner', status: 'approved' }, restriction: 'paused' })).toBe('restricted');
  });

  // A pending or rejected membership that is also restricted leads with the restriction:
  // "you are suspended" is the more actionable of the two, and the more urgent.
  it('is restricted, not pending or rejected, when both apply', () => {
    expect(viewerKindOf({ membership: { role: 'member', status: 'pending' }, restriction: 'suspended' })).toBe('restricted');
    expect(viewerKindOf({ membership: { role: 'member', status: 'rejected' }, restriction: 'suspended' })).toBe('restricted');
  });

  /**
   * An owner whose membership is not approved is not an owner for CTA purposes — they
   * fall through to the status branches like anybody else. Pinned because the owner test
   * is a conjunction and dropping either half changes this answer.
   */
  it('does not treat a pending owner as an owner', () => {
    expect(viewerKindOf({ membership: { role: 'owner', status: 'pending' }, restriction: 'none' })).toBe('pending');
  });
});
