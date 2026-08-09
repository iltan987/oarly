import type { ReactNode } from 'react';

import { ClubBrand } from '@/components/app-brand';
import { AppShell } from '@/components/app-shell';
import { MemberTabs } from '@/components/member-tabs';
import { UserMenu } from '@/components/user-menu';
import { menuSession } from '@/lib/menu-session';
import { getCurrentUser } from '@/lib/session';
import { requireClub } from '@/lib/tenant';

export default async function MemberLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  const user = await getCurrentUser();
  return (
    <AppShell
      width="2xl"
      brand={<ClubBrand name={club.name} logoUrl={club.logoUrl} href="/" />}
      menu={<UserMenu session={menuSession(user, { tenant: true })} />}
    >
      {/*
        The tabs live in the CONTENT column, not the full-bleed header: their `border-b`
        is a rule under the content, and stretching it to the header's 1440px container
        would leave it wider than everything it underlines.
      */}
      <MemberTabs />
      {children}
    </AppShell>
  );
}
