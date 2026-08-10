import { and, count, eq } from 'drizzle-orm';
import { Check, Circle } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { db } from '@/db';
import { memberships } from '@/db/schema';
import { listBoats } from '@/lib/boats';
import { todayInClub } from '@/lib/date-tz';
import { requireOwner } from '@/lib/membership';
import { getDayRoster, rosterDayTotals } from '@/lib/roster';
import { listWindowsWithBoats } from '@/lib/schedule';
import { listSkillLevels } from '@/lib/skill-levels';

export const metadata: Metadata = { robots: { index: false, follow: false } };

type ChecklistItem = { done: boolean; label: string; href: string };

function Checklist({ items, doneLabel, todoLabel }: { items: ChecklistItem[]; doneLabel: string; todoLabel: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col divide-y divide-border p-0">
        {items.map((item) => (
          <div key={item.href} className="flex items-center justify-between gap-3 p-3 first:pt-0 last:pb-0">
            <span className="flex items-center gap-2">
              {item.done
                ? <Check aria-hidden className="size-4 shrink-0 text-ok" />
                : <Circle aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
              <span className={item.done ? 'text-muted-foreground line-through' : 'font-medium'}>{item.label}</span>
            </span>
            <Button size="sm" variant={item.done ? 'ghost' : 'outline'} render={<Link href={item.href} />}>
              {item.done ? doneLabel : todoLabel}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default async function ManageOverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');

  const todayISO = todayInClub(new Date(), club.timezone);
  const [levels, boats, windows, [pending], today] = await Promise.all([
    listSkillLevels(db, club.id),
    listBoats(db, club.id),
    listWindowsWithBoats(db, club.id),
    db.select({ n: count() }).from(memberships)
      .where(and(eq(memberships.clubId, club.id), eq(memberships.status, 'pending'))),
    getDayRoster(db, { clubId: club.id, dateISO: todayISO }),
  ]);

  // Public-facing links: the tenant subdomain rewrites `/manage/...` to `/s/{slug}/manage/...`
  // internally (see proxy.ts / tenant-routing.ts), but the browser URL — and any client-side
  // navigation from a `<Link>` — must use the public `/manage/...` form (slug is in the
  // hostname, not the path). Linking to `/s/${slug}/manage/...` here would double-prefix on
  // the next request and 404.
  const checklist: ChecklistItem[] = [
    { done: levels.length > 0, label: t('setupSkill'), href: '/manage/skill-levels' },
    { done: boats.some((b) => b.active), label: t('setupBoats'), href: '/manage/boats' },
    { done: windows.length > 0, label: t('setupSchedule'), href: '/manage/schedule' },
    { done: Boolean(club.tagline || club.description), label: t('setupProfile'), href: '/manage/profile' },
  ];
  const setupComplete = checklist.every((i) => i.done);

  // A club that finished setup a year ago should not be greeted by a wall of ticks every
  // time it opens /manage. The checklist is a FIRST-RUN guide — the only thing that leads
  // a brand-new owner to the setup pages at all — so it renders until every item is done
  // and then goes away entirely.
  //
  // It used to collapse into a <details> instead. That was a second, worse copy of
  // /manage/settings: four ticks where the index shows four counts, one click away, and
  // it forced <Checklist> to be rendered twice in one file. The index replaced it.
  if (!setupComplete) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-lg font-semibold">{t('setupTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('setupIntro')}</p>
        </div>
        <Checklist items={checklist} doneLabel={t('setupDone')} todoLabel={t('setupTodo')} />
      </div>
    );
  }

  const pendingCount = pending?.n ?? 0;
  // Shared with /manage/bookings, which renders the same three numbers beside its date
  // control. The `status === 'booked'` rule (seated includes no_show rows, kept visible so
  // an owner can undo the mark) lives in the helper, once.
  const { seated, waitlisted, capacity } = rosterDayTotals(today.sessions);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-semibold">{t('overviewTitle')}</h2>

      <Card size="sm">
        <CardContent className="flex flex-col divide-y divide-border p-0">
          <div className="flex items-center justify-between gap-3 p-3 first:pt-0">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{t('requestsHeading')}</span>
              <span className="text-sm text-muted-foreground">{t('requestsPending', { count: pendingCount })}</span>
            </div>
            <Button size="sm" variant={pendingCount > 0 ? 'outline' : 'ghost'} render={<Link href="/manage/members" />}>
              {t('requestsCta')}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 p-3 last:pb-0">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{t('todayHeading')}</span>
              <span className="text-sm text-muted-foreground">
                {today.closed
                  ? t('todayClosed')
                  : today.sessions.length === 0
                    ? t('todayNone')
                    : t('todaySummary', { seated, capacity, sessions: today.sessions.length, waitlisted })}
              </span>
            </div>
            <Button size="sm" variant="ghost" render={<Link href="/manage/bookings" />}>
              {t('todayCta')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
