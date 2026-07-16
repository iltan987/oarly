import type { ReactNode } from 'react';
import { ClubTheme } from '@/components/club-theme';
import { requireClub } from '@/lib/tenant';

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const club = await requireClub(slug);
  return <ClubTheme accent={club.brandAccent}>{children}</ClubTheme>;
}
