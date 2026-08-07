'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/**
 * A submit button that derives its pending state from the enclosing <form> via
 * `useFormStatus()` instead of taking it as a prop.
 *
 * Why this shape rather than `disabled={pending}` at each call site:
 *
 *  - `useFormStatus` is scoped to the NEAREST ANCESTOR <form>. Several call sites
 *    (bookings-roster, skill-levels-editor, profile-form) deliberately hoist ONE
 *    `useActionState` into the list parent so the success toast survives the row
 *    unmounting on revalidation — but they then reused that single `pending` flag for
 *    every row, so removing one member greyed out Remove on every row. Because each row
 *    already renders its own <form>, this component gives per-row pending for free and
 *    leaves the deliberate hoisting untouched.
 *  - It removes `pending` from every component's prop surface. The policies form
 *    regressed precisely by dropping the third slot of the `useActionState` tuple; there
 *    is no third slot to drop here.
 *
 * `data-pending` is exposed so an ancestor can react in pure CSS — Tailwind's
 * `has-data-pending:` / `group-has-data-pending:` compile to `:has()`. Destructive rows
 * use that to fade IN PLACE rather than unmount: removing the node reflows every row
 * below it, and that reflow is what let a second click land on a different member's
 * booking (see spec §1.2).
 */
export function PendingButton({
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      {...props}
      disabled={disabled || pending}
      data-pending={pending ? '' : undefined}
    >
      {/*
        The label is never replaced by the spinner — swapping it would change the
        button's width mid-flight, which is its own form of layout shift.
      */}
      {pending && <Spinner />}
      {children}
    </Button>
  );
}
