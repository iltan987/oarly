'use client';

import { PendingButton } from '@/components/pending-button';

export function JoinForm({ action, body, cta }: {
  action: () => void | Promise<void>;
  body: string;
  cta: string;
}) {
  return (
    <form action={action} className="w-full">
      <p className="mb-4 text-muted-foreground">{body}</p>
      <PendingButton className="w-full">{cta}</PendingButton>
    </form>
  );
}
