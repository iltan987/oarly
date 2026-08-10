import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The "there is nothing here" block: a title, an optional sentence explaining what would
 * put something here, and an optional control that does it.
 *
 * **No copy lives in this component.** Every string is a prop, so next-intl stays the only
 * source of member-facing text and `messages-parity.test.ts` still sees each key at its
 * call site. A `title = 'Nothing here'` default is how untranslated English reaches a
 * Turkish-default app — the same rule `ConfirmDialog` applies to its labels.
 *
 * `action` is a `ReactNode` rather than a label + href pair because two of the three call
 * sites have no action at all, and the one that does wants a real `next/link` so the
 * navigation is prefetched — not a button that pushes on click.
 */
export function EmptyState({ title, body, action, className }: {
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-1.5 py-8 text-center text-sm', className)}>
      <p className="font-heading font-semibold">{title}</p>
      {body ? <p className="text-muted-foreground">{body}</p> : null}
      {/*
        Rendered only when there is one. An always-present wrapper would contribute its
        own `gap-1.5` of empty space below the body on the two call sites that pass
        nothing, which reads as a missing control rather than as a deliberate absence.
      */}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
