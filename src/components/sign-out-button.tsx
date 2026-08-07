'use client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { authClient } from '@/auth-client';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export function SignOutButton({ redirectTo }: { redirectTo: string }) {
  const t = useTranslations('common');

  // Not a <form action>, so `useFormStatus` — and therefore `PendingButton` — cannot
  // see this: the round trip is an `authClient` call from an onClick. Hence local
  // state. Spec 8: only the pending state is in scope here, the `window.location.href`
  // navigation is deliberately left alone.
  const [pending, setPending] = useState(false);

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => {
        setPending(true);
        authClient
          .signOut()
          // Stays pending through the navigation: clearing it here would flash the
          // button back to idle while the browser is already unloading the page.
          .then(() => { window.location.href = redirectTo; })
          .catch(() => setPending(false));
      }}
    >
      {pending && <Spinner />}
      {t('signOut')}
    </Button>
  );
}
