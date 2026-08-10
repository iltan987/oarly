'use client';

import type { ReactNode } from 'react';

import { PendingButton } from '@/components/pending-button';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
      <DialogContent>
        {open && (
          <form action={action} onSubmit={onSubmit} className="flex flex-col gap-4">
            {Object.entries(hidden ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{description}</p>
            {children}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>{dismissLabel}</DialogClose>
              <PendingButton variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</PendingButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
