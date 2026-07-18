import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Public tenant paths (slug is in the hostname — see proxy.ts). Never /s/{slug}/...
const tabs = [
  { key: 'book', href: '/book', labelKey: 'book' },
  { key: 'bookings', href: '/bookings', labelKey: 'myBookings' },
] as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export async function MemberHeader({
  active,
  club,
}: {
  active: 'book' | 'bookings';
  club: { name: string; logoUrl: string | null };
}) {
  const t = await getTranslations('booking');
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
          <SignOutButton />
        </div>
      </div>
      <nav className="flex flex-wrap gap-1 border-b">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`border-b-2 px-3 py-2 text-sm ${
                isActive
                  ? 'border-brand font-medium text-brand'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
