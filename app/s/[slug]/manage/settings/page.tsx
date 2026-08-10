import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { db } from '@/db';
import { listBoats } from '@/lib/boats';
import { listSocials } from '@/lib/club-profile';
import { requireOwner } from '@/lib/membership';
import { listWindowsWithBoats } from '@/lib/schedule';
import { listSkillLevels } from '@/lib/skill-levels';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The index the four-item nav folded five setup pages behind.
 *
 * A menu of five words would be strictly worse than the nav it replaced — one more click
 * to reach the same five places, buying nothing. What earns the click is the **state
 * summary** on every row: an owner can answer "did I ever cap the waitlist?" or "are any
 * of my boats actually active?" here, without opening five pages to find out.
 *
 * ## Why `getSchedulingSettings` is not called
 *
 * `requireOwner` returns the whole `clubs` row (`Club = typeof clubs.$inferSelect`), so
 * `bookingOpenMode`, `bookingOpenLeadDays`, `selfCancelEnabled`, `cancelCutoffHours`,
 * `noshowPenalty` and `waitlistCapacity` are already in hand by the time this function
 * body runs. `getSchedulingSettings` would re-SELECT columns we are holding. The
 * policies row therefore costs **zero queries**, and `settings/page.test.tsx` asserts it
 * stays that way.
 *
 * The other four rows are one `Promise.all` — four queries in flight together, not four
 * awaits in a row. `listWindowsWithBoats` is two statements internally, but the second is
 * a single `inArray` over every window id (src/lib/schedule.ts:39-43), not one per
 * window, so the schedule row is not an N+1 either.
 */
export default async function ManageSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { club } = await requireOwner(slug, '/manage/settings');
  const t = await getTranslations('manage');

  const [socials, levels, boats, windows] = await Promise.all([
    listSocials(db, club.id),
    listSkillLevels(db, club.id),
    listBoats(db, club.id),
    listWindowsWithBoats(db, club.id),
  ]);

  // Public tenant paths: the slug is in the hostname, so a `<Link>` must never carry the
  // internal `/s/{slug}/...` form (see ./_nav.tsx). None of these URLs changed when the
  // nav shrank — this page is a new index over them, not a new home for them.
  const rows = [
    {
      href: '/manage/profile',
      label: t('profile.navLabel'),
      summary: t('settings.profileSummary', {
        filled: [club.tagline, club.description, club.logoUrl].filter(Boolean).length,
        socials: socials.length,
      }),
    },
    {
      href: '/manage/skill-levels',
      label: t('skillLevels.navLabel'),
      summary: t('settings.skillLevelsSummary', { count: levels.length }),
    },
    {
      href: '/manage/boats',
      label: t('boats.navLabel'),
      summary: t('settings.boatsSummary', {
        count: boats.length,
        active: boats.filter((b) => b.active).length,
      }),
    },
    {
      href: '/manage/schedule',
      label: t('schedule.navLabel'),
      summary: t('settings.scheduleSummary', {
        windows: windows.length,
        days: new Set(windows.map((w) => w.weekday)).size,
      }),
    },
    {
      href: '/manage/policies',
      label: t('policies.navLabel'),
      summary: t('settings.policiesSummary', {
        mode: club.bookingOpenMode,
        leadDays: club.bookingOpenLeadDays ?? 0,
        // `select` branches on strings, so the boolean is spelled out here rather than
        // relying on ICU to stringify it.
        selfCancel: club.selfCancelEnabled ? 'on' : 'off',
        // `null` and `0` are OPPOSITE states, not two spellings of "unset", and this row
        // read them as the same thing until review caught it.
        //
        // `src/lib/booking.ts:178` is the authority:
        //   `club.waitlistCapacity == null ? Infinity : capacity + club.waitlistCapacity`
        // — `null` means the waitlist is unbounded; `0` means there is no waitlist at all,
        // because a session then accepts exactly its own seats and `joinWaitlist` returns
        // `waitlist_full` on the next request.
        //
        // And `0` is a value an owner can set: `src/lib/schemas.ts:148` is
        // `z.coerce.number().int().min(0).max(999).nullable()` and
        // `policies/policies-form.tsx:149` renders `<Input type="number" min={0}>`. Typing
        // 0 into that box IS how you switch waitlisting off. Collapsing it onto the same
        // ICU branch as `null` told that owner their waitlist was uncapped — on the one
        // page whose entire justification is answering "did I ever cap the waitlist?"
        // without opening the policies form.
        waitlist:
          club.waitlistCapacity == null ? 'unlimited' : club.waitlistCapacity === 0 ? 'off' : 'capped',
        // Always passed, including in the two branches that do not render it: next-intl
        // throws on a referenced argument that is absent, and which branch runs is the
        // message's business, not this call site's.
        waitlistCap: club.waitlistCapacity ?? 0,
      }),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-heading text-lg font-semibold">{t('settings.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.intro')}</p>
      </div>

      <Card className="gap-0 divide-y divide-border py-0">
        {rows.map((row) => (
          <Link key={row.href} href={row.href} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">{row.label}</span>
              <span className="text-sm text-muted-foreground">{row.summary}</span>
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </Card>

      <Separator />

      {/*
        The two links that used to sit under the manage title, in a `flex-wrap` row of
        their own — a whole row of chrome above every page in the console, on every
        viewport. They are EXITS from the console, not navigation within it, which is why
        grouping them with the nav read as a fifth and sixth destination.

        One DOM location, not a `hidden` / `lg:hidden` pair: duplicating them would give a
        screen-reader user two "Member view" links, one of which is invisible.
      */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewPublicPage')}
        </Link>
        <Link href="/book" className="text-muted-foreground hover:text-foreground hover:underline">
          {t('viewAsMember')}
        </Link>
      </div>
    </div>
  );
}
