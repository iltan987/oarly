import type { ReactNode } from 'react';

import { ClubBrand } from '@/components/app-brand';
import { AppShell } from '@/components/app-shell';
import { MemberTabs } from '@/components/member-tabs';
import { UserMenu } from '@/components/user-menu';
import { getMemberRestriction } from '@/lib/membership';
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
  // `getMemberRestriction` is request-memoized (`cache()`), not a fresh `getRestriction`
  // call — see its doc comment in `src/lib/membership.ts` for why a layout rendering
  // chrome that has to outlive `loading.tsx` cannot instead receive the page's own,
  // already-computed `Restriction` as a prop. An anonymous or non-member visitor is
  // 'none' here; the page underneath still runs its own guard and turns them away.
  const restriction = user ? await getMemberRestriction(user.id, club.id) : { state: 'none' as const };
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
      <MemberTabs restricted={restriction.state !== 'none'} />
      {children}
    </AppShell>
  );
}
