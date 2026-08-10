'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * The one "are you sure?" in this codebase.
 *
 * Six sites hand-rolled the same twenty lines — `<Dialog>` / `<DialogContent>` / a `<form>`
 * whose `action` is the `useActionState` dispatcher / a hidden id / a header / a body / a
 * `DialogClose` and a `PendingButton`. Extracting it is worth doing for three reasons that
 * are not "it is shorter":
 *
 * 1. **No label has a default.** `confirmLabel` and `dismissLabel` are both required. A
 *    `dismissLabel = 'Cancel'` default is exactly how untranslated English reaches a
 *    Turkish-default app, and next-intl has to stay the only source of copy or
 *    `messages-parity.test.ts` stops seeing a key at its call site. It is also what keeps
 *    the two footer controls from sharing an accessible name — see `dismissLabel` below.
 *
 * 2. **It owns the mount-only-while-open rule**, which every hand-rolled site had to
 *    remember and one component cannot forget. `decision-buttons.tsx:57-59` states the
 *    case: a rejection reason typed into an abandoned dialog must not survive into the
 *    next request's approval.
 *
*    Honest scope of that claim, measured rather than assumed: `DialogContent` portals
 *    through Base UI's `Dialog.Portal`, whose `keepMounted` defaults to `false`
 *    (`node_modules/@base-ui/react/dialog/portal/DialogPortal.js:32` — `shouldRender =
 *    mounted || keepMounted`). So the portal ALREADY unmounts the subtree on close, and
 *    deleting this gate changes nothing observable today: `confirm-dialog.test.tsx` was
 *    run against a build with `{open && …}` removed and all six tests still passed, in
 *    jsdom both synchronously after the close and across a reopen. The gate stays as the
 *    explicit statement of the rule — a `keepMounted` added to `DialogPortal`, or a
 *    content wrapper that stops portalling, would silently restore the leak this line
 *    prevents — but it is NOT test-defended, and `confirm-dialog.test.tsx` says so where
 *    it asserts the freshness contract.
 *
 * 3. **`children` render inside the `<form>`, above the footer**, so a site that needs one
 *    extra field (the admin note textarea) composes rather than forking the component.
 *
 * The trap this component must NOT undo (`bookings-roster.tsx:43-53`): Base UI portals the
 * form out of the triggering row's DOM subtree, so the row's `has-data-pending:` CSS bridge
 * — a `:has()` selector — can no longer see the submit button, and the row stops dimming
 * while the action is in flight. That is why `onSubmit` exists here: it is the hook a
 * caller uses to set its own pending-row id on the submitting frame.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  dismissLabel,
  destructive = false,
  action,
  onSubmit,
  hidden,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What actually happens on confirm. Required: a dialog that only asks "are you sure?" adds a tap and no information. */
  description: string;
  confirmLabel: string;
  /**
   * Required, and it must not be the trigger's word. Two controls sharing one accessible
   * name is how an "are you sure?" stops being a second decision
   * (`decision-buttons.tsx:80-81`) — a Cancel button whose confirmation offers
   * "Cancel / Cancel" is the degenerate case.
   */
  dismissLabel: string;
  destructive?: boolean;
  /** The `useActionState` dispatcher, or a plain async function — whatever `<form action>` takes. */
  action: (formData: FormData) => void | Promise<void>;
  /**
   * Runs on the submitting frame, before the action. The hook for a caller that has to
   * bridge the portal — see the class comment.
   */
  onSubmit?: () => void;
  /** Serialised as `<input type="hidden">` inside the form. */
  hidden?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `showCloseButton={false}`, and this is a copy decision rather than a layout one.
        `DialogContent`'s X button carries a hardcoded English `<span className="sr-only">
        Close</span>` (`ui/dialog.tsx:75`) — it lives in the CLI-owned `ui/` directory and
        cannot be hand-translated, so on a Turkish-default app it is one English word in
        the middle of a Turkish flow, and it is the ONLY accessible name that control has.
        A confirmation already carries an explicit, translated dismiss control, so the X
        was redundant before it was wrong: nothing is lost by removing it, and Escape and
        the backdrop still close the dialog.
      */}
      <DialogContent showCloseButton={false}>
        {open && (
          <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
            {Object.entries(hidden ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            {/*
              `DialogDescription`, not a bare `<p>`. Base UI registers this element's id on
              the popup's `aria-describedby`; a plain paragraph leaves it `undefined`, so a
              screen reader announces the title and never the sentence — and on the cancel
              gate that sentence is the entire justification for the extra tap. The visual
              result is identical: the primitive's class list is the one this used to spell
              out by hand.
            */}
            <DialogDescription>{description}</DialogDescription>
            {children}
            {/*
              Confirm FIRST in the DOM, dismiss second, with the desktop order restored by
              `sm:order-*`.

              `DialogFooter` is `flex-col-reverse` below `sm:` (`ui/dialog.tsx:105`), so the
              first child renders at the BOTTOM of the stack and the last at the top. With
              the intuitive [dismiss, confirm] order that put the destructive button
              directly under the body text — the first control a member's eye and thumb
              reach after reading what is about to happen, on the one dialog that can cost
              them a seat. Reversed, the safe choice is what they meet first.

              At `sm:` and up the row is horizontal and the convention is dismiss-left /
              confirm-right, which `sm:order-1` / `sm:order-2` restores — so desktop is
              unchanged. jsdom has no layout, so `confirm-dialog.test.tsx` can only assert
              the DOM order and the two order classes; the rendered stack itself was
              checked in Chrome at 320px.
            */}
            <DialogFooter>
              <PendingButton className="sm:order-2" variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</PendingButton>
              <DismissButton>{dismissLabel}</DismissButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The dismiss control, split out only so it can read `useFormStatus()` — which is scoped
 * to the nearest ancestor `<form>` and therefore has to be called from a component INSIDE
 * the one above.
 *
 * It is disabled once the confirm is in flight, and that is about meaning rather than
 * double submission. This button's label is a promise — "Yerimi koru" / "Keep my seat" —
 * and the moment the action is dispatched that promise is already false: the seat is
 * going. A control that claims to undo something it cannot is worse than no control.
 *
 * Escape and the backdrop are deliberately NOT blocked. They promise nothing except "get
 * this out of my way", and blocking every exit would trap a member behind a request that
 * never settles. The caller is expected to keep its own trigger disabled for the round
 * trip so a dialog dismissed mid-flight still leaves the work visible — `CancelButton` in
 * `bookings-list.tsx` does exactly that, and its test is what enforces it.
 *
 * No `pending` prop: a caller that forgot to pass it would silently get the lying button
 * back, and `useFormStatus` cannot be forgotten.
 */
function DismissButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <DialogClose render={<Button type="button" variant="ghost" className="sm:order-1" disabled={pending} />}>
      {children}
    </DialogClose>
  );
}
