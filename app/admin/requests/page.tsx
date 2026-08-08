import { desc, eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { StatusPill } from '@/components/booking-status-badge';
import { Card } from '@/components/ui/card';
import { db } from '@/db';
import { clubs } from '@/db/schema';

/*
 * This queue is read-only for now, and that is deliberate rather than unfinished.
 *
 * It used to approve with `<ClubStatusButton targetStatus="active">`, i.e. the very
 * control the clubs list used to un-suspend — which is what made a brand-new club and a
 * reinstated one indistinguishable in the audit log (spec §5.3). `setClubStatus` now
 * refuses a `pending` club outright, so that button could no longer approve anything; it
 * would have rendered as an operative approve path that fails every time, under a message
 * ("Only an approved club can be suspended or reinstated") written for a different page
 * and incoherent on this one.
 *
 * A control that cannot do what it says is worse than no control. The real approve/reject
 * UI — `decideClubRequest`, the required rejection note, and a confirmation dialog naming
 * the club — replaces this page in a later task.
 */
export default async function AdminClubRequestsPage() {
  const t = await getTranslations('admin');
  const rows = await db.select().from(clubs).where(eq(clubs.status, 'pending')).orderBy(desc(clubs.createdAt));
  if (rows.length === 0) return <p className="text-muted-foreground">{t('noRequests')}</p>;
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {rows.map((c) => (
        <div key={c.id} className="flex items-center justify-between gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{c.name}</span>
            <span className="text-sm text-muted-foreground">{c.slug}</span>
          </div>
          <StatusPill tone="warn">{t('statusPending')}</StatusPill>
        </div>
      ))}
    </Card>
  );
}
