import { and, asc, desc, eq, ilike, inArray, ne, or, type SQL, sql } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { boatTypes, clubs, memberships, scheduleWindows, SLUG_ADDRESSABLE_STATUSES, user } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { DB } from '@/lib/membership';
import { clampPage } from '@/lib/pagination';
import { escapeLike } from '@/lib/search-params';
import { validateSlug } from '@/lib/slug';

// Better Auth's internal adapter lowercases `email` on both `createUser` and
// `findUserByEmail` (see internal-adapter.ts), so every row Better Auth writes
// already has a lowercase email — matching against `.toLowerCase()` here is
// consistent with how Better Auth itself looks users up, no `lower()` SQL needed.
export async function createClub(
  db: DB,
  input: { name: string; slug: string; ownerEmail: string; createdBy: string },
): Promise<{ ok: true; clubId: string } | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'owner_not_found' }> {
  const v = validateSlug(input.slug);
  if (!v.ok) return { ok: false, error: v.reason === 'reserved' ? 'slug_reserved' : 'slug_invalid' };

  const [owner] = await db.select().from(user).where(eq(user.email, input.ownerEmail.trim().toLowerCase())).limit(1);
  if (!owner) return { ok: false, error: 'owner_not_found' };

  // Mirrors the partial index `clubs_slug_uq` — literally, via the same constant: a
  // rejected request no longer holds its slug, so it must not report `slug_taken`
  // either, and spelling the filter the index's own way is what lets this pre-check
  // use it instead of scanning `clubs`.
  const [existing] = await db.select({ id: clubs.id }).from(clubs)
    .where(and(eq(clubs.slug, input.slug), inArray(clubs.status, SLUG_ADDRESSABLE_STATUSES))).limit(1);
  if (existing) return { ok: false, error: 'slug_taken' };

  return db.transaction(async (tx) => {
    const [club] = await tx.insert(clubs)
      .values({ name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy })
      .returning({ id: clubs.id });
    await tx.insert(memberships).values({ userId: owner.id, clubId: club.id, role: 'owner', status: 'approved' });
    await logAudit(tx, { actorUserId: input.createdBy, clubId: club.id, action: 'club.create', target: club.id, actingAsRole: 'admin' });
    return { ok: true, clubId: club.id };
  });
}

/**
 * Does this string contain at least one letter or digit?
 *
 * The test for "the operator actually wrote a reason". Punctuation, emoji, zero-width
 * characters and braille blanks all fail it, which is intended: a rejection is
 * irreversible and the note is the entire record of why, both in `review_note` and in
 * the email the requester receives.
 */
const LEGIBLE_TEXT_RE = /[\p{L}\p{N}]/u;
function hasLegibleText(value: string): boolean {
  return LEGIBLE_TEXT_RE.test(value);
}

export type DecideClubRequestResult =
  | { ok: true; status: 'active' | 'rejected'; requesterId: string | null; clubName: string; clubSlug: string }
  | { ok: false; error: 'not_found' | 'not_pending' | 'note_required' };

/**
 * Decide a club REQUEST. Valid only on a row that is currently `pending`.
 *
 * Deliberately not `setClubStatus`: approving a new club and reinstating a
 * suspended one were indistinguishable to the audit trail when they shared one
 * function (spec §5.3). The note is required when rejecting so the requester's
 * email can say why, and optional when approving. That requirement cannot live in
 * the schema — `review_note` is nullable because an approval has none — so this
 * check is the only thing enforcing it.
 *
 * Returns the requester and club identity on success so the caller can send the
 * decision email AFTER the transaction commits — mail is best-effort and must
 * never roll back the decision (spec §5.4).
 */
export async function decideClubRequest(
  db: DB,
  input: { clubId: string; decision: 'approve' | 'reject'; note: string | null; actorId: string },
): Promise<DecideClubRequestResult> {
  // A note with nothing legible in it is not a note. `trim()` alone was not enough:
  // it strips ECMAScript WhiteSpace, and the characters that render as blank are not
  // all whitespace. `U+200B ZERO WIDTH SPACE` is general category `Cf`, so it survived
  // a trim — a rejection note of one zero-width space was accepted, stored as
  // `review_note`, logged as `club.reject`, and mailed to the requester as a rejection
  // whose reason renders blank. Same for `U+2800 BRAILLE PATTERN BLANK` (category
  // `So`, so stripping `Cf` alone would not have caught it).
  //
  // Hence `hasLegibleText` rather than a blocklist of invisible characters: the
  // requirement is that the reason SAYS something, and the only way to be sure of that
  // is to require something legible to be present. The stored value is the trimmed
  // ORIGINAL, not a stripped copy — a note in Arabic or Hebrew legitimately carries
  // `Cf` bidi marks, and rewriting the operator's words would mangle it.
  const trimmed = input.note?.trim() ?? '';
  const note = hasLegibleText(trimmed) ? trimmed : null;
  if (input.decision === 'reject' && !note) return { ok: false, error: 'note_required' };

  return db.transaction(async (tx) => {
    // `.for('update')` is load-bearing, not defensive. READ COMMITTED gives this
    // transaction a snapshot taken at each statement, so without the row lock two
    // admins clearing the queue in the same second both read `pending`, both pass the
    // guard below, and both write: the audit log then records the club as BOTH
    // approved and rejected, `reviewedBy`/`reviewNote` reflect whichever committed
    // last regardless of audit order, and the requester is emailed both decisions.
    // The lock makes the loser block until the winner commits, re-read `active` or
    // `rejected`, and refuse with `not_pending`.
    const [club] = await tx
      .select({ id: clubs.id, status: clubs.status, name: clubs.name, slug: clubs.slug, createdBy: clubs.createdBy })
      .from(clubs)
      .where(eq(clubs.id, input.clubId))
      .limit(1)
      .for('update');
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'pending') return { ok: false, error: 'not_pending' };

    const status = input.decision === 'approve' ? ('active' as const) : ('rejected' as const);
    await tx.update(clubs)
      .set({ status, reviewedAt: new Date(), reviewedBy: input.actorId, reviewNote: note })
      .where(eq(clubs.id, club.id));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: club.id,
      action: input.decision === 'approve' ? 'club.approve' : 'club.reject',
      target: club.id,
      actingAsRole: 'admin',
    });
    return { ok: true, status, requesterId: club.createdBy, clubName: club.name, clubSlug: club.slug };
  });
}

export type SetClubStatusResult =
  | { ok: true; status: 'active' | 'suspended' }
  | { ok: false; error: 'not_found' | 'not_decided' };

/**
 * Suspend or reinstate an ALREADY-DECIDED club. `pending` and `rejected` are
 * unreachable through here: a request is decided by `decideClubRequest`, and a
 * rejection is final. Reaching either through this function is a typed error,
 * not a silent write — that refusal is what stops the requests queue and the
 * clubs list from sharing one control again (spec §5.3).
 *
 * The `rejected` half is not merely tidy. Slug uniqueness is a PARTIAL index that
 * exempts rejected rows, so a live club may already hold a rejected club's slug;
 * walking that rejected row back to `active` would hit `clubs_slug_uq` at best,
 * and shadow a live club at worst.
 */
export async function setClubStatus(
  db: DB,
  input: { clubId: string; status: 'active' | 'suspended'; actorId: string },
): Promise<SetClubStatusResult> {
  return db.transaction(async (tx) => {
    // Same lock as `decideClubRequest`, for the same reason: a guard is only worth as
    // much as the read it guards, and an unlocked read under READ COMMITTED can be
    // stale by the time the UPDATE lands.
    //
    // Honest scope: today no verb can move a DECIDED club back to `pending` or
    // `rejected` — `decideClubRequest` only touches `pending` rows — so no currently
    // reachable interleaving makes this guard read the wrong status, and no test here
    // fails without this lock. It is defence in depth for the next writer (an archive
    // or delete verb), and it costs one clause. The alternative is that the two
    // decision paths in this file disagree about whether a status check needs a lock,
    // which is how the next one gets written without one.
    const [club] = await tx.select({ id: clubs.id, status: clubs.status })
      .from(clubs).where(eq(clubs.id, input.clubId)).limit(1).for('update');
    if (!club) return { ok: false, error: 'not_found' };
    if (club.status !== 'active' && club.status !== 'suspended') return { ok: false, error: 'not_decided' };

    await tx.update(clubs).set({ status: input.status }).where(eq(clubs.id, input.clubId));
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: input.status === 'active' ? 'club.activate' : 'club.suspend',
      target: input.clubId,
      actingAsRole: 'admin',
    });
    return { ok: true, status: input.status };
  });
}

export type TransferOwnershipResult =
  | { ok: true; fromUserId: string | null }
  | { ok: false; error: 'club_not_found' | 'target_not_member' | 'already_owner' };

/**
 * Move ownership of a club to an existing approved member.
 *
 * A TRANSFER, not an invitation: the target must already be an approved member of
 * this club. Promoting a stranger is the invitation flow, which is deferred
 * (spec §7). Until now `memberships.role` was only ever written at INSERT time —
 * there is no `setRole` anywhere — so a club whose owner walked away could not be
 * reassigned by anyone, including a platform admin (spec §6.3).
 *
 * Demote-then-promote in ONE transaction, so the club is never observed ownerless
 * and never observed with two owners; this cycle does not introduce multiple owners.
 */
export async function transferOwnership(
  db: DB,
  input: { clubId: string; toUserId: string; actorId: string },
): Promise<TransferOwnershipResult> {
  return db.transaction(async (tx) => {
    // `.for('update')` on the CLUB row is what serialises two concurrent transfers,
    // and it is load-bearing rather than defensive. This function reads the
    // memberships, decides, and then writes two of them — the same check-then-act
    // shape that let two concurrent `decideClubRequest` calls both win. With no lock,
    // under READ COMMITTED: both transactions read their own target as an eligible
    // member; the first demotes the owner and promotes its target; the second's demote
    // (`WHERE role = 'owner'`) blocks, then re-evaluates against the committed row,
    // finds it is now `member`, matches NOTHING, and promotes a SECOND owner.
    //
    // Why the CLUB row and not the owner membership rows — the interesting part, and
    // NOT because the racers fail to meet on those rows. They do meet: they share the
    // old owner's row, and locking `WHERE role = 'owner'` serialises the ordinary
    // transfer perfectly well (verified — the ordinary race test passes with that
    // lock substituted in).
    //
    // It fails on the one club that matters most: an OWNERLESS one, which is precisely
    // the club this function was added to repair. There, `WHERE role = 'owner'` matches
    // zero rows, so `FOR UPDATE` over it locks nothing, the two transfers never meet,
    // both demote nothing, and both promote — two owners. The club row always exists,
    // so it serialises the repair as well as the ordinary case. Both scenarios have
    // their own test; substituting an owner-row lock fails the ownerless one 3/3.
    const [club] = await tx.select({ id: clubs.id }).from(clubs)
      .where(eq(clubs.id, input.clubId)).limit(1).for('update');
    if (!club) return { ok: false, error: 'club_not_found' };

    // Scoped by clubId AND userId: a membership in some other club is not a
    // membership in this one, and matching on the user alone would let any approved
    // member anywhere be handed this club.
    //
    // Also locked, for a different race than the one above: a concurrent
    // member-rejection or ban on this exact row would otherwise land between this
    // read and the promote, and hand the club to someone the club just removed.
    const [target] = await tx
      .select({ id: memberships.id, role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.userId, input.toUserId)))
      .limit(1)
      .for('update');
    if (!target || target.status !== 'approved') return { ok: false, error: 'target_not_member' };
    // Refused BEFORE the demote, not merely as a courtesy: the demote below matches
    // every `owner` row of this club, so falling through with an already-owner target
    // would demote the target and then re-promote it — or, if the two statements ever
    // drift apart, leave the club with no owner at all.
    if (target.role === 'owner') return { ok: false, error: 'already_owner' };

    // Demote first, promote second. The reverse order would momentarily match the
    // freshly promoted row with `WHERE role = 'owner'` and undo itself.
    const demoted = await tx.update(memberships).set({ role: 'member' })
      .where(and(eq(memberships.clubId, input.clubId), eq(memberships.role, 'owner')))
      .returning({ userId: memberships.userId });
    await tx.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, target.id));

    // Inside the transaction, on `tx`: a role change that committed without its audit
    // row is precisely what an audit log exists to make impossible.
    await logAudit(tx, {
      actorUserId: input.actorId,
      clubId: input.clubId,
      action: 'club.transfer_owner',
      target: input.toUserId,
      actingAsRole: 'admin',
    });
    // `null` when the club had no owner to begin with — the exact situation this
    // function was added to repair, so it is a normal outcome, not an error.
    return { ok: true, fromUserId: demoted[0]?.userId ?? null };
  });
}

/**
 * How many owners and transfer candidates `/admin/clubs/[id]` will load.
 *
 * Neither list is paginated, so both are capped rather than unbounded: a club with
 * a thousand approved members must not turn one admin page view into a thousand-row
 * fetch feeding a thousand-option `<select>`. A club has exactly one owner, so
 * `OWNER_LIMIT` only ever matters for pre-existing data.
 */
const OWNER_LIMIT = 10;
export const TRANSFER_CANDIDATE_LIMIT = 200;

export type ClubAdminDetail = {
  club: typeof clubs.$inferSelect;
  reviewedByName: string | null;
  owners: { userId: string; name: string; email: string }[];
  memberCounts: { pending: number; approved: number; rejected: number; banned: number };
  transferCandidates: { userId: string; name: string; email: string }[];
  /**
   * `transferCandidates` hit `TRANSFER_CANDIDATE_LIMIT` and there may be more.
   *
   * Surfaced rather than left implicit because the truncation is ALPHABETICAL — the
   * list is ordered by name — so on an oversized club the back half of the alphabet
   * would simply never appear in the picker, with nothing on screen to say so. A
   * silent cap that quietly excludes half the members by surname is worse than a
   * visible one. The real fix is a search-backed picker (deferred, spec §7).
   */
  transferCandidatesTruncated: boolean;
  boatCount: number;
  windowCount: number;
};

/** Everything `/admin/clubs/[id]` renders, in one place, keyed by id (spec §6.1). */
export async function getClubAdminDetail(db: DbOrTx, clubId: string): Promise<ClubAdminDetail | null> {
  const [club] = await db.select().from(clubs).where(eq(clubs.id, clubId)).limit(1);
  if (!club) return null;

  // A FUNCTION, not a shared builder: drizzle's `.where()`/`.limit()` mutate the
  // query object and return `this`, so reusing one builder for both lists below
  // would have the second call overwrite the first's WHERE clause.
  const people = (where: SQL | undefined, limit: number) => db
    .select({ userId: memberships.userId, name: user.name, email: user.email })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(where)
    // `user.id` breaks the tie so the order is total: names are not unique, and a
    // list that reshuffles between renders is a list an admin cannot click safely.
    .orderBy(asc(user.name), asc(user.id))
    .limit(limit);

  const [owners, transferCandidates, counts, boats, windows] = await Promise.all([
    people(and(eq(memberships.clubId, clubId), eq(memberships.role, 'owner')), OWNER_LIMIT),
    // Approved non-owners only — `transferOwnership` refuses everyone else, so
    // offering them here would only ever produce a guaranteed error toast.
    people(
      and(
        eq(memberships.clubId, clubId),
        ne(memberships.role, 'owner'),
        eq(memberships.status, 'approved'),
      ),
      TRANSFER_CANDIDATE_LIMIT,
    ),
    // Grouped, not four round trips and not a full roster in memory: the result is
    // bounded by the four values of `membership_status`.
    db.select({ status: memberships.status, n: sql<number>`count(*)::int` })
      .from(memberships).where(eq(memberships.clubId, clubId)).groupBy(memberships.status),
    db.select({ n: sql<number>`count(*)::int` }).from(boatTypes).where(eq(boatTypes.clubId, clubId)),
    db.select({ n: sql<number>`count(*)::int` }).from(scheduleWindows).where(eq(scheduleWindows.clubId, clubId)),
  ]);

  const memberCounts = { pending: 0, approved: 0, rejected: 0, banned: 0 };
  for (const row of counts) memberCounts[row.status] = row.n;

  let reviewedByName: string | null = null;
  if (club.reviewedBy) {
    // `reviewed_by` is `on delete set null` on the column but the reviewer may still
    // have been deleted between the decision and now, so a missing row is normal.
    const [reviewer] = await db.select({ name: user.name }).from(user).where(eq(user.id, club.reviewedBy)).limit(1);
    reviewedByName = reviewer?.name ?? null;
  }

  return {
    club,
    reviewedByName,
    owners,
    memberCounts,
    transferCandidates,
    // `===` and not `>=`: the query cannot return more than it asked for, and a full
    // page is the only signal available that a next one might exist.
    transferCandidatesTruncated: transferCandidates.length === TRANSFER_CANDIDATE_LIMIT,
    boatCount: boats[0]?.n ?? 0,
    windowCount: windows[0]?.n ?? 0,
  };
}

export const CLUBS_PAGE_SIZE = 25;

export type AdminClubRow = {
  id: string;
  slug: string;
  name: string;
  status: typeof clubs.$inferSelect['status'];
  createdAt: Date;
  memberCount: number;
};

/**
 * Paged, searchable club list. Replaces the unbounded `db.select().from(clubs)` the
 * admin index used to run (spec §6.4) — no list page in the console may issue an
 * unbounded select, and there is no unbounded branch here either: an empty search is
 * still capped at `pageSize`.
 *
 * `page` is clamped HERE rather than only at the route, for the same reason
 * `searchUsers` clamps: it is interpolated into `OFFSET`, which Postgres parses as
 * `bigint`, so `?page=1.5`, `?page=Infinity` and `?page=1e20` each raised
 * `invalid input syntax for type bigint` out of the render on a URL anyone can
 * hand-edit. Putting the clamp in the library is what makes a new caller inherit it
 * instead of repeating the bug. The returned `page` is the one actually shown —
 * pulled back to the last page that exists — so the rows, the row range and the
 * pagination links all describe the same page.
 */
export async function listClubsForAdmin(
  db: DbOrTx,
  opts: { q?: string; page?: number; pageSize?: number } = {},
): Promise<{ rows: AdminClubRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? CLUBS_PAGE_SIZE;
  const q = opts.q?.trim();
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const where = pattern ? or(ilike(clubs.name, pattern), ilike(clubs.slug, pattern)) : undefined;

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(clubs).where(where);
  const total = countRow?.n ?? 0;
  // Counted before the page is resolved on purpose: the clamp needs the total.
  const page = clampPage(opts.page, total, pageSize);

  const pageRows = await db
    .select({
      id: clubs.id,
      slug: clubs.slug,
      name: clubs.name,
      status: clubs.status,
      createdAt: clubs.createdAt,
    })
    .from(clubs)
    .where(where)
    // `id` breaks the tie so the order is total: two clubs created in the same
    // microsecond would otherwise be free to swap places between pages, which is how
    // offset pages start overlapping and dropping rows.
    .orderBy(desc(clubs.createdAt), desc(clubs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Member counts in ONE follow-up query keyed by the page's ids, exactly as
  // `searchUsers` fetches memberships. Not a join into the select above — that would
  // multiply the club rows by their membership count and break both LIMIT and `total`.
  //
  // And deliberately NOT a correlated `sql` subquery in the selection either. Drizzle
  // strips the table prefix from a Column interpolated into a raw `sql` SELECT field
  // whenever the query has a single table (`buildSelection`'s `isSingleTable`), so
  // `where ${memberships.clubId} = ${clubs.id}` compiles to `where "club_id" = "id"` —
  // which Postgres happily resolves against the SUBQUERY's own table, comparing
  // `memberships.club_id` to `memberships.id`. It matches nothing, raises nothing, and
  // reports every club as having zero members.
  const ids = pageRows.map((c) => c.id);
  const counts = ids.length
    ? await db
        .select({ clubId: memberships.clubId, n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(inArray(memberships.clubId, ids))
        .groupBy(memberships.clubId)
    : [];
  const countByClub = new Map(counts.map((c) => [c.clubId, c.n]));

  return {
    rows: pageRows.map((c) => ({ ...c, memberCount: countByClub.get(c.id) ?? 0 })),
    total,
    page,
    pageSize,
  };
}

export type PendingClubRequest = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  requesterName: string | null;
  requesterEmail: string | null;
};

export const CLUB_REQUESTS_PAGE_SIZE = 25;

/**
 * The requests queue: one page of the clubs still awaiting a decision.
 *
 * PAGED, and the queue does not drain on its own — the reasoning that said otherwise
 * was wrong. `requestClub` writes `status: 'pending'` with no expiry and no TTL, there
 * is no sweeper anywhere in the repo, nothing decides a request except a human working
 * through a dialog one club at a time, and signup is open. The only throttle is a
 * per-account rate limit of 5/hour, which is 120 a day for ONE account. A fortnight of
 * admin absence during a growth spurt, or one motivated user with a handful of
 * verified addresses, is enough to leave thousands of rows — and the unpaginated
 * version selected and rendered every one of them, each mounting a client component
 * with its own `useActionState` and `Dialog`, on the very page an admin has to load to
 * fix the situation.
 *
 * OLDEST FIRST, unlike every other list in the console. Order does not matter much on
 * an unpaginated list; on a paged one it decides what an admin ever sees. Newest-first
 * would park the request that has waited longest on the last page and leave it there,
 * which is how a backlog starves instead of draining.
 *
 * `page` is clamped HERE and not only at the route, for the reason `listClubsForAdmin`
 * documents: it is interpolated into `OFFSET`, which Postgres parses as `bigint`, and a
 * route-only guard does nothing for a direct call.
 *
 * LEFT join on the requester, not inner. `clubs.created_by` is `on delete set null`,
 * so a requester who deleted their account leaves a live request with a null author —
 * and an inner join would drop that request out of the queue entirely, where nobody
 * could ever approve or reject it. The club would sit `pending` forever, holding its
 * slug against the partial unique index.
 */
export async function listPendingClubRequests(
  db: DbOrTx,
  opts: { page?: number; pageSize?: number } = {},
): Promise<{ rows: PendingClubRequest[]; total: number; page: number; pageSize: number }> {
  const pageSize = opts.pageSize ?? CLUB_REQUESTS_PAGE_SIZE;
  const where = eq(clubs.status, 'pending');

  const [countRow] = await db.select({ n: sql<number>`count(*)::int` }).from(clubs).where(where);
  const total = countRow?.n ?? 0;
  // Counted before the page is resolved on purpose: the clamp needs the total.
  const page = clampPage(opts.page, total, pageSize);

  const rows = await db
    .select({
      id: clubs.id,
      slug: clubs.slug,
      name: clubs.name,
      createdAt: clubs.createdAt,
      requesterName: user.name,
      requesterEmail: user.email,
    })
    .from(clubs)
    .leftJoin(user, eq(user.id, clubs.createdBy))
    .where(where)
    // `id` breaks the tie so the order is total: two requests created in the same
    // microsecond would otherwise be free to swap places between pages, which is how an
    // offset page serves one request twice and skips another entirely.
    .orderBy(asc(clubs.createdAt), asc(clubs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total, page, pageSize };
}
