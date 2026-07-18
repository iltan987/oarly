import type { ReactNode } from 'react';

import { MemberHeader } from '@/components/member-header';
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
  return (
    <div className="mx-auto max-w-2xl p-4">
      <MemberHeader club={{ name: club.name, logoUrl: club.logoUrl }} />
      {children}
    </div>
  );
}
