import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { AdminPagination } from '@/components/admin-pagination';
import { StatusPill } from '@/components/booking-status-badge';
import { EmptyState } from '@/components/empty-state';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { db } from '@/db';
import { skillLevels } from '@/db/schema';
import { listPendingMembers, MEMBERS_PAGE_SIZE, PENDING_CAP, searchClubMembers } from '@/lib/members-admin';
import { requireOwner } from '@/lib/membership';
import { normalizePage } from '@/lib/pagination';
import { restrictionState } from '@/lib/restriction';
import { one } from '@/lib/search-params';

import { PendingMembers } from './pending-members';
import { SkillLevelSelect } from './skill-level-select';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ManageMembersPage({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { club } = await requireOwner(slug);
  const t = await getTranslations('manage');
  /*
    The badge date used to be `toLocaleDateString('en-GB', …)` on a page whose default
    locale is Turkish, so a Turkish owner read "12 August" in the middle of a Turkish
    sentence. `getFormatter()` resolves the request's locale, the same way
    `restriction-notice.tsx:169` formats the date the MEMBER is shown for the same ban.

    Options inline rather than named: `src/i18n/request.ts` returns no `formats` config,
    so there is nothing to name and a `format="short"` string would silently fall back.
  */
  const f = await getFormatter();
  const day = (d: Date) => f.dateTime(d, { day: 'numeric', month: 'long', timeZone: club.timezone });
  const now = new Date();

  const q = one(sp.q)?.trim() || undefined;
  // `?page=1.5` reaches `OFFSET` as `12.5` and raises `invalid input syntax for type
  // bigint` out of the render — a 500 on a URL anyone can hand-edit.
  // `searchClubMembers` clamps again on its own; this keeps a nonsense value from ever
  // leaving the route. Belt and braces, as `app/admin/users/page.tsx:23-31` documents.
  const requestedPage = normalizePage(one(sp.page));

  const pending = await listPendingMembers(db, { clubId: club.id, cap: PENDING_CAP });
  // `page` is what came BACK, not what was asked for: the library pulls an out-of-range
  // page down to the last one that exists, and the range below plus the pagination links
  // have to describe the page the rows actually came from.
  const { rows, total, page } = await searchClubMembers(db, {
    clubId: club.id, q, page: requestedPage, pageSize: MEMBERS_PAGE_SIZE,
  });
  const levels = await db.select().from(skillLevels).where(eq(skillLevels.clubId, club.id)).orderBy(skillLevels.rank);

  const from = total === 0 ? 0 : (page - 1) * MEMBERS_PAGE_SIZE + 1;
  const to = Math.min(page * MEMBERS_PAGE_SIZE, total);

  return (
    <div className="flex flex-col gap-8">
      {/*
        Hidden ENTIRELY when the queue is empty — no heading, no sentence, no gap. An
        empty work queue should occupy zero pixels: a heading above "nothing here" is a
        standing reminder of work that does not exist, on the page the owner opens to
        find work that does.
      */}
      {pending.total > 0 && (
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold">{t('pendingHeading')}</h2>
          {/* A client component for the whole queue, not per row: it owns the
              pending-reject id that bridges Base UI's portal, and it hoists both
              `useActionState`s so a decision's toast survives the row unmounting on
              revalidation. See its doc comment. */}
          <PendingMembers slug={slug} rows={pending.rows} />
          {/*
            A NUMBER, not a pager. Pending is never paginated and never filtered: it
            drains, so it is small by construction, and a page 2 is a place for a join
            request to sit unanswered for a month.
          */}
          {pending.total > pending.rows.length && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('pendingMore', { count: pending.total - pending.rows.length })}
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold">{t('approvedHeading')}</h2>

        {/* A plain GET form, so the search lands in the URL and is shareable. The submit is
            a plain Button, not PendingButton: `useFormStatus` reports nothing for a browser
            navigation, so it would render a control that never shows progress.

            `/manage/members`, never `/s/{slug}/manage/members` — the slug is in the
            hostname, and the internal form would double-prefix through the proxy rewrite. */}
        <form method="get" action="/manage/members" className="mb-4 flex max-w-md gap-2">
          <Input name="q" defaultValue={q ?? ''} placeholder={t('membersSearch')} aria-label={t('membersSearch')} />
          <Button type="submit" size="sm">{t('membersSearchCta')}</Button>
        </form>

        {levels.length === 0 && rows.length > 0 && (
          // Once, above the list — not once per row. At 25 rows the per-row copy this
          // replaces was 25 identical sentences down the column the eye scans for levels.
          <p className="mb-3 text-sm text-muted-foreground">{t('noSkillLevels')}</p>
        )}

        {rows.length === 0 ? (
          /*
            Three different facts, three different sentences. One shared string here is
            the bug `app/admin/page.tsx:69-73` documents being fixed once already: "No
            members yet" under a search that matched nothing is a flat false statement
            about a club with 200 people in it.
          */
          q ? (
            <EmptyState title={t('noMatchTitle')} body={t('noMatchBody')} />
          ) : pending.total > 0 ? (
            <EmptyState title={t('noApprovedTitle')} body={t('noApprovedBody')} />
          ) : (
            <EmptyState
              title={t('noMembersTitle')}
              body={t('noMembersBody')}
              action={
                <Link href="/" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  {t('viewPublicPage')}
                </Link>
              }
            />
          )
        ) : (
          /*
            One Card with `divide-y` rows, not one Card per member: 25 cards at `gap-2` is
            25 shadows and 25 gutters, and a 200-member club made that the whole page. The
            idiom `app/admin/users/page.tsx:64` already uses for the same 25 people.

            At `lg:` the ragged `flex-wrap justify-between` row becomes a three-column
            grid, and the fixed `12rem` last column is what the width buys: `1fr` absorbs
            every difference in name length and badge width, so every skill-level select
            shares one left edge down the whole list. Assigning levels to 30 members is one
            vertical pass instead of 30 horizontal hunts. Below `lg:` the stack is
            unchanged.
          */
          <Card className="gap-0 divide-y divide-border py-0">
            {rows.map((r) => {
              /*
                The suspended/paused split is `restrictionState`'s, not this page's. Two
                copies of that predicate is how the owner's roster and the member's own
                page start disagreeing about who is restricted.

                `bannedUntil!` under `'paused'` is that state's invariant, not an
                assumption: the model returns `paused` only when the date is non-null and
                in the future.
              */
              const restriction = restrictionState(r, now);
              return (
                <div
                  key={r.membershipId}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 lg:grid lg:grid-cols-[1fr_auto_12rem] lg:items-center lg:gap-4"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-heading text-sm font-semibold break-words">{r.name}</span>
                    <span className="text-xs break-words text-muted-foreground">{r.email}</span>
                  </div>
                  {/*
                    Its own cell even when empty, so the select column below does not
                    shift by the width of a badge.

                    The words are `restriction`'s, not this page's second set. The owner
                    badge said *yasaklı* ("banned") for the exact state the member is told
                    is *Duraklatıldı* ("paused"), off the same predicate — so an owner
                    reading the roster and a member reading their own page described one
                    fact with two registers, one of which Task 6 removed on purpose.
                    Guarded in `src/i18n/tr-restriction-vocabulary.test.ts`.
                  */}
                  <div>
                    {restriction === 'suspended' ? (
                      <StatusPill tone="bad">{t('suspendedBadge')}</StatusPill>
                    ) : restriction === 'paused' ? (
                      <StatusPill tone="warn">{t('pausedBadge', { date: day(r.bannedUntil!) })}</StatusPill>
                    ) : null}
                  </div>
                  {levels.length > 0 && (
                    <SkillLevelSelect
                      slug={slug}
                      membershipId={r.membershipId}
                      skillLevels={levels}
                      currentSkillLevelId={r.skillLevelId}
                      label={t('skillLevel')}
                      noneLabel={t('none')}
                    />
                  )}
                </div>
              );
            })}
          </Card>
        )}

        <AdminPagination
          basePath="/manage/members"
          query={{ q }}
          page={page}
          pageSize={MEMBERS_PAGE_SIZE}
          total={total}
          prevLabel={t('paginationPrev')}
          nextLabel={t('paginationNext')}
          rangeLabel={t('paginationRange', { from, to, total })}
        />
      </section>
    </div>
  );
}
