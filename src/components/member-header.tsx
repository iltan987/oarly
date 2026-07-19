import Link from 'next/link';

import { MemberTabs } from '@/components/member-tabs';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { env } from '@/env';
import { apexUrl, parseAppOrigin } from '@/lib/urls';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

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
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <SignOutButton redirectTo={signOutUrl} />
        </div>
      </div>
      <MemberTabs />
    </header>
  );
}
