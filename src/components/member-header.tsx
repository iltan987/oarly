import Link from 'next/link';

import { AppControls } from '@/components/app-controls';
import { MemberTabs } from '@/components/member-tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { env } from '@/env';
import { initials } from '@/lib/initials';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

export function MemberHeader({
  club,
}: {
  club: { name: string; logoUrl: string | null };
}) {
  const signOutUrl = apexUrl('/sign-in?signedout=1', parseAppOrigin(env.APP_URL));
  return (
    <header className="mb-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <Avatar className="size-8 shrink-0 rounded-field after:rounded-field">
            {club.logoUrl ? <AvatarImage src={club.logoUrl} alt="" className="rounded-field" /> : null}
            <AvatarFallback className="rounded-field bg-brand font-heading text-xs font-bold text-primary-foreground">
              {initials(club.name)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate font-heading text-lg font-semibold text-brand">{club.name}</span>
        </Link>
        <AppControls signOutUrl={signOutUrl} />
      </div>
      <MemberTabs />
    </header>
  );
}
