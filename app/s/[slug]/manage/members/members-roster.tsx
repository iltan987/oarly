'use client';

import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { StatusPill } from '@/components/booking-status-badge';
import { PendingButton } from '@/components/pending-button';
import { Card } from '@/components/ui/card';

import type { ManageActionResult } from '../action-result';
import { liftSuspensionAction } from './actions';
import { SkillLevelSelect } from './skill-level-select';

/**
 * One roster row, with every locale-dependent decision already made.
 *
 * `restriction` and `badgeLabel` arrive READY: the split is `restrictionState`'s, and the
 * date is formatted by the page through `getFormatter()` and the club's timezone. Two
 * copies of that predicate is how the owner's roster and the member's own page start
 * disagreeing about who is restricted, and a date formatted in the browser's locale is
 * "12 August" in the middle of a Turkish sentence.
 */
export type RosterRow = {
  membershipId: string;
  name: string;
  email: string;
  skillLevelId: string | null;
  restriction: 'none' | 'paused' | 'suspended';
  /** The badge's words, or null when the member is not restricted at all. */
  badgeLabel: string | null;
  /**
   * The lift control's accessible name. Names the member — 25 rows of one label are 25
   * controls a screen-reader user cannot tell apart, on a page where the wrong one
   * reinstates the wrong person.
   *
   * It must CONTAIN the visible label (WCAG 2.5.3, Label in Name), which is the rule
   * `src/components/restriction-notice.tsx:127-133` already states for the club's phone
   * link: the accessible name adds what a screen reader cannot infer, it does not
   * REPLACE what is on screen. An `aria-label` overrides the visible text entirely, so
   * "Askıyı kaldır" + `aria-label="{name} adlı üyenin askısını kaldırın"` leaves a
   * voice-control user saying "click Askıyı kaldır" with nothing to click — on the one
   * control that gives a member their access back. Held by the catalog
   * (`Askıyı kaldır: {name}`) and asserted in `members-roster.test.tsx`.
   */
  liftLabel: string;
};

export type RosterLabels = {
  skillLevel: string;
  none: string;
  /** The lift control's visible label. */
  lift: string;
  liftDone: string;
  error: string;
};

/**
 * The club's roster, and the one control that can undo a suspension.
 *
 * ## Why the lift has no confirmation, when Reject one section above does
 *
 * `app/admin/club-status-button.tsx:13-30` states this codebase's rule: the destructive
 * direction confirms and NAMES its subject; the restorative direction does not, because
 * "an extra click on a control whose only effect is to restore service is friction with
 * nothing behind it". Lifting only ever gives a member back what they had. If it was a
 * mis-click, the absence is still on the record — the penalty rows are stamped, not
 * deleted — and the owner can mark the next one.
 *
 * The corollary is that the two controls must not be confusable, because one of them is
 * one careless tap from ending somebody's membership. They are separated three ways, on
 * purpose: different sections of the page (Reject lives in the pending queue, this lives
 * in the roster below it), different words (`liftSuspension` vs `reject`, guarded in
 * `src/i18n/tr-restriction-vocabulary.test.ts`), and different weight — `outline` here
 * against `destructive` there. Sharing a variant would put a red button on the roster
 * whose only effect is restorative, which teaches the wrong thing about red buttons.
 *
 * ## Why `useActionState` is hoisted here rather than living in the row
 *
 * A successful lift revalidates the route, and the control is rendered ONLY on a
 * suspended row — so the component holding a row-local `useActionState` is unmounted by
 * the very success it is waiting to report, and the toast effect never runs. Hoisted to
 * the list, the dispatcher outlives it (`bookings-roster.tsx:66-70`, and
 * `pending-members.tsx`, which does exactly this for the same reason).
 *
 * Hoisting the dispatcher does NOT grey out every row's button: `PendingButton` reads
 * `useFormStatus`, which is scoped to the nearest ancestor `<form>`, and there is one per
 * row. The `has-data-pending:` bridge on the row is the same `:has()` selector the
 * pending queue uses; nothing here is portalled, so no second, JS-side bridge is needed.
 */
export function MembersRoster({ slug, rows, skillLevels, labels }: {
  slug: string;
  rows: readonly RosterRow[];
  skillLevels: { id: string; name: string }[];
  labels: RosterLabels;
}) {
  const [liftState, liftAction] = useActionState<ManageActionResult | null, FormData>(
    liftSuspensionAction.bind(null, slug), null,
  );
  // `useActionState` hands back the SAME object on unrelated re-renders, so the effect is
  // guarded by identity rather than by a dependency list alone — otherwise a second row's
  // render re-toasts the first row's result.
  const handled = useRef<ManageActionResult | null>(null);
  useEffect(() => {
    if (liftState === null || liftState === handled.current) return;
    handled.current = liftState;
    if (liftState.ok) toast.success(labels.liftDone);
    else toast.error(labels.error);
  }, [liftState, labels]);

  return (
    /*
      One Card with `divide-y` rows, not one Card per member: 25 cards at `gap-2` is 25
      shadows and 25 gutters, and a 200-member club made that the whole page. The idiom
      `app/admin/users/page.tsx:64` already uses for the same 25 people.

      At `lg:` the ragged `flex-wrap justify-between` row becomes a three-column grid, and
      the fixed `12rem` last column is what the width buys: `1fr` absorbs every difference
      in name length and badge width, so every skill-level select shares one left edge down
      the whole list. Assigning levels to 30 members is one vertical pass instead of 30
      horizontal hunts. Below `lg:` the stack is unchanged.
    */
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((r) => (
        <div
          key={r.membershipId}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 transition-opacity has-data-pending:opacity-40 lg:grid lg:grid-cols-[1fr_auto_12rem] lg:items-center lg:gap-4"
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-heading text-sm font-semibold break-words">{r.name}</span>
            <span className="text-xs break-words text-muted-foreground">{r.email}</span>
          </div>
          {/*
            Its own cell even when empty, so the select column below does not shift by the
            width of a badge. The words are `restriction`'s, not a second set: the owner
            badge said *yasaklı* ("banned") for the exact state the member is told is
            *Duraklatıldı* ("paused"), off the same predicate. Guarded in
            `src/i18n/tr-restriction-vocabulary.test.ts`.
          */}
          <div className="flex flex-wrap items-center gap-2">
            {r.restriction === 'suspended' ? (
              <StatusPill tone="bad">{r.badgeLabel}</StatusPill>
            ) : r.restriction === 'paused' ? (
              <StatusPill tone="warn">{r.badgeLabel}</StatusPill>
            ) : null}
            {/*
              Only on a suspension. A pause ends by itself on a date the badge beside this
              already names, so a control there would offer to undo something that is
              already undoing itself — and it is the permanent case, the one with no other
              way out, that this exists for.
            */}
            {r.restriction === 'suspended' && (
              <form action={liftAction}>
                <input type="hidden" name="membershipId" value={r.membershipId} />
                <PendingButton size="sm" variant="outline" aria-label={r.liftLabel}>
                  {labels.lift}
                </PendingButton>
              </form>
            )}
          </div>
          {skillLevels.length > 0 && (
            <SkillLevelSelect
              slug={slug}
              membershipId={r.membershipId}
              skillLevels={skillLevels}
              currentSkillLevelId={r.skillLevelId}
              label={labels.skillLevel}
              noneLabel={labels.none}
            />
          )}
        </div>
      ))}
    </Card>
  );
}
