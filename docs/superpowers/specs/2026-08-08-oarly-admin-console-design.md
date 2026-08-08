# Admin console

**Date:** 2026-08-08
**Status:** approved for implementation
**Depends on:** nothing outstanding. Touches `clubs`, `audit_log`, `memberships`, and the
`app/admin` tree, none of which have work in flight.

## 1. Problem

> "I think admin ui is bad now. Basically almost has no functionality. Just can see
> clubs, can ban and can create a new club I guess."

Accurate, and the audit found it is thinner than that reads. The whole admin surface is
**364 lines across 11 files**, and it offers exactly three verbs: list clubs, flip a club
between active and suspended, and create a club.

Two structural problems sit underneath the missing pages.

**A club request is not an entity.** It is a `clubs` row with `status = 'pending'`. There
is no requester note, no contact, no reviewed-by, no reviewed-at. Because the only
transition available is "make it active", the Approve control on `/admin/requests` is
*literally the same component* as the un-suspend control on `/admin` — the same
`ClubStatusButton` with the same `targetStatus="active"`. Approving a new club and
reinstating a suspended one are indistinguishable to the code and to the audit trail.

There is also **no way to decline**. `club_status` is `['pending', 'active', 'suspended']`,
so a rejected request has nowhere to go: it sits in the queue forever, or an admin
suspends it, which misfiles a request that was never a club as a club that misbehaved.

**The audit log is written by 2 of 24 eligible mutations and read by nothing.** An audit
of every `src/lib/*.ts` module and every `app/` server action found 24 mutations performed
by an owner or admin *against another person or against club-wide configuration*. Only
`createClub` and `setClubStatus` call `logAudit`. Member bans, no-show penalties, forced
booking removal, policy changes, boat edits, schedule deletions — none are recorded. And
no page displays the table, so even those two rows are write-only.

## 2. What already exists and works

Worth stating so the plan does not "fix" it:

- **Suspension is properly enforced.** `requireActiveClub` (`src/lib/membership.ts:32`)
  gates both `requireOwner` and `requireMember`, so a suspended club's owner cannot drive
  mutations by POSTing an action directly. The comment there is explicit that this exists
  because layouts do not govern server actions.
- `requireAdmin` (`src/lib/session.ts:29`) gates the whole `app/admin` tree via the layout
  and is keyed on `user.is_admin`.
- `logAudit` already demonstrates the in-transaction pattern
  (`logAudit(tx as unknown as DB, …)`), so atomic audit writes need no new machinery.

## 3. Scope

**In scope**

1. Audit logging that means something: an `admin` actor role, coverage across the owner
   and admin mutations, and a viewer.
2. A real approve/reject decision on club requests, including the slug consequence.
3. A club detail page.
4. A users page with search and the platform-admin toggle.
5. Ownership transfer.
6. Search and pagination on the list pages.

**Out of scope**

- **Impersonation** ("act as owner"). Still deferred; `audit_log.acting_as_role` exists
  for it and this cycle finally gives that column a non-null use, but the feature itself
  needs owner surface it does not yet have.
- **Inviting an owner who has no account.** `createClub` requires the owner's user row to
  exist already, which is a real onboarding limitation, but fixing it means an invitation
  token and an email flow — its own cycle. §7.
- **Club deletion.** Suspension covers the operational need and deletion cascades into
  bookings and audit rows. Not now.
- **A superadmin/paid tier.** Unchanged from the feature-toggles spec.

## 4. Audit logging

### 4.1 The actor role column cannot express "admin"

`audit_log.acting_as_role` is declared `membershipRoleEnum('acting_as_role')`, and that
enum (`src/db/schema/enums.ts`) is `['owner', 'member']`. There is no `admin` value. This
is why both existing `logAudit` calls — both of them admin-driven — leave it null.

Add `'admin'` to `membershipRoleEnum` rather than introducing a second column or a loose
`text`. The column's meaning is "the role this actor was exercising", and platform admin
is one of those roles; a parallel column would create two sources of truth for one fact.
Postgres `ALTER TYPE ... ADD VALUE` is additive and does not rewrite rows.

Note for the implementer: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block
in Postgres versions before 12. This project targets Postgres 18 (CI and Neon both), where
it is allowed, but Drizzle emits it as its own statement regardless — do not hand-merge it
into another migration file's transaction.

### 4.2 What gets audited

The rule, which the plan must apply rather than enumerate blindly:

> Record every mutation an owner or admin performs **against another person, or against
> configuration that binds other people**. Do not record member self-service.

By that rule, `bookSeat`, `cancelBooking`, `requestToJoin` and `requestClub` stay
unaudited — a member acting on their own seat is not an exercise of authority. Everything
in the following table is audited, with the action string given here so the strings are
decided once, in the spec, and not invented per task.

| Module | Function | `action` |
|---|---|---|
| `members-admin.ts` | `setMembershipStatus` | `member.approve` / `member.reject` |
| `members-admin.ts` | `assignSkillLevel` | `member.skill_assign` |
| `attendance.ts` | `markNoShow` | `attendance.noshow` |
| `attendance.ts` | `undoNoShow` | `attendance.noshow_undo` |
| `booking.ts` | `ownerAddBooking` | `booking.owner_add` |
| `booking.ts` | `ownerRemoveBooking` | `booking.owner_remove` |
| `scheduling-settings.ts` | `updateSchedulingSettings` | `club.policies_update` |
| `club-profile.ts` | `updateClubProfile` | `club.profile_update` |
| `boats.ts` | `createBoat` / `updateBoat` / `setBoatActive` | `boat.create` / `boat.update` / `boat.set_active` |
| `skill-levels.ts` | `createSkillLevel` / `renameSkillLevel` / `reorderSkillLevel` / `deleteSkillLevel` | `skill_level.create` / `.rename` / `.reorder` / `.delete` |
| `schedule.ts` | `createWindow` / `updateWindow` / `deleteWindow` | `window.create` / `.update` / `.delete` |
| `date-overrides.ts` | `setDateOverride` / `clearDateOverride` | `date_override.set` / `.clear` |
| `clubs-admin.ts` | `createClub` | `club.create` *(exists)* |
| `clubs-admin.ts` | `setClubStatus` | `club.activate` / `club.suspend` *(exists)* |
| `clubs-admin.ts` | `decideClubRequest` | `club.approve` / `club.reject` *(new, §5)* |
| `clubs-admin.ts` | `transferOwnership` | `club.transfer_owner` *(new, §6.3)* |
| `users-admin.ts` | `setPlatformAdmin` | `user.admin_grant` / `user.admin_revoke` *(new, §6.2)* |

`setClubLogo`, `addSocial` and `removeSocial` are deliberately **excluded**: they are
cosmetic self-description of the club, carry no authority over a person, and would drown
the log. This is a judgment call and the spec owns it, so a reviewer should not flag their
absence as an oversight.

### 4.3 Atomicity

Eight of these functions already open `db.transaction(...)` and must take `tx`, so the
audit row commits with the mutation or not at all.

The rest are single statements today. **Wrap them in a transaction** rather than appending
a second unrelated round-trip. A statement plus an insert is a trivial transaction, and the
alternative — a mutation that succeeded with no audit row — is the exact failure an audit
log exists to prevent. The affected functions are `setMembershipStatus`, `assignSkillLevel`,
`updateClubProfile`, `createBoat`, `updateBoat`, `setBoatActive`, `createSkillLevel`,
`renameSkillLevel`, `deleteSkillLevel`, `deleteWindow`, `setDateOverride`,
`clearDateOverride`.

`logAudit` currently takes `DB` and every in-transaction caller casts
(`tx as unknown as DB`). Widen the parameter type to accept a transaction directly and
delete the casts. This is the only refactor of existing code the cycle mandates.

### 4.4 The viewer

`/admin/audit`: newest first, keyset-paginated (`created_at`, `id`), filterable by club,
by actor, and by action prefix. It resolves `actor_user_id` to a name/email and `club_id`
to a club name — both are `on delete set null`, so **the UI must render a deleted actor or
club without crashing**, showing the raw id or a dash. A row whose subject is gone is still
evidence.

`target` is free text holding an id. Render it verbatim; do not attempt to resolve it.

## 5. Club requests: a real decision

### 5.1 The rejected state

Add `'rejected'` to `club_status`. A rejected club is invisible everywhere by the existing
rule — `requireActiveClub` already 404s anything not `active`.

Record the decision on the row: `reviewed_at timestamptz`, `reviewed_by text` referencing
`user.id` with `on delete set null`, and `review_note text` for the reason. The note is
**required when rejecting** and optional when approving.

### 5.2 Rejection must not hold the slug hostage — and the fix has a trap

`clubs.slug` is `text NOT NULL UNIQUE` (constraint `clubs_slug_unique`). If a rejected row
keeps its slug under that constraint, a spam request for `bogazici` **permanently burns
that name** and the real club can never claim it.

Replace the constraint with a partial unique index that excludes rejected rows:

```sql
ALTER TABLE "clubs" DROP CONSTRAINT "clubs_slug_unique";
CREATE UNIQUE INDEX "clubs_slug_uq" ON "clubs" ("slug")
  WHERE "status" IN ('pending', 'active', 'suspended');
```

**The predicate must enumerate the surviving values — it may not say
`WHERE status <> 'rejected'`.** Postgres forbids *using* an enum value in the same
transaction that added it, and Drizzle's migrator runs all pending migrations inside one
transaction. Measured against `postgres:18`:

| Predicate | Fresh database | Already-migrated database |
|---|---|---|
| `status <> 'rejected'` | ✅ commits | ❌ `unsafe use of new value "rejected" of enum type club_status` |
| `status::text <> 'rejected'` | ❌ `functions in index predicate must be marked IMMUTABLE` | ❌ same |
| `status IN ('pending','active','suspended')` | ✅ commits | ✅ commits |

The first row is the trap. On a fresh database the enum type is *created* in that same
transaction, which Postgres does permit — so the `<>` form passes every integration test
and every CI run, then fails on production, where the type already exists. It would surface
as a failed Vercel production build inside `scripts/deploy-migrate.mjs`.

The `IN` form is semantically identical today. If `club_status` ever gains another value,
that predicate must be extended — which is the correct failure mode, since a new status
needs a deliberate decision about whether it holds a slug.

**The trap this creates, which is the single most dangerous item in this cycle.** Once
rejected rows are exempt, a rejected `bogazici` and a live `bogazici` can coexist.
`getClubBySlug` (`src/lib/tenant.ts`) is:

```ts
db.select().from(clubs).where(eq(clubs.slug, slug)).limit(1)
```

`LIMIT 1` with no `ORDER BY` and no status filter would return **either** row at the
planner's discretion. Landing on the rejected one 404s a live club — intermittently, and
only for clubs whose slug was once rejected. `getClubBySlug` must therefore exclude
rejected rows in the same change that adds the partial index, never in a later task.

The invariant: **a rejected club is not addressable by slug.**

### 5.3 Approve is not the same verb as un-suspend

Introduce `decideClubRequest(db, { clubId, decision, note, actorId })`, valid only on a
row currently `pending`. It sets `active` or `rejected`, stamps the reviewed fields, and
writes `club.approve` or `club.reject`.

`setClubStatus` stays, but is restricted to `active <-> suspended` on a non-pending club.
Attempting to reach `pending` or `rejected` through it is a typed error, not a silent
write. This is what stops the two flows sharing one control.

### 5.4 Close the loop with the requester

Today a requester submits, sees "submitted", and **never learns the outcome** — there is no
status page and no email on approval or rejection. Send one on both decisions via the
existing `sendEmail` (`src/lib/email.ts`), with new `emails.clubApproved` and
`emails.clubRejected` message keys (the rejection carries the note). Email failure must not
roll back the decision: send **after** the transaction commits, and swallow-and-log a send
error, matching how the rest of the app treats mail as best-effort.

## 6. New surfaces

### 6.1 Club detail — `/admin/clubs/[id]`

Keyed by **id, not slug**, precisely because §5.2 makes slugs non-unique across rejected
rows. Shows identity and status, owners and member counts by status, the club's boats and
schedule-window counts, the last 20 audit rows for that club, and the status actions.

### 6.2 Users — `/admin/users`

Search by email or name (case-insensitive prefix/substring), paginated. Each row shows the
user's memberships with club and role. One mutation: `setPlatformAdmin`.

Two guards, both server-side:

- **An admin may not revoke their own admin flag.** Prevents the trivial self-lockout.
- **The last remaining admin may not be revoked.** Counted inside the same transaction as
  the update so a concurrent double-revoke cannot empty the set.

### 6.3 Ownership transfer

Confirmed absent: `memberships.role` is only ever written at insert time, and no
`setRole`/`transferOwner` exists anywhere. So a club whose owner leaves cannot be
reassigned by anyone.

`transferOwnership(db, { clubId, toUserId, actorId })`, from the club detail page, in one
transaction: promote the target to `owner`, demote the previous owner to `member`, audit
`club.transfer_owner`. The target must already be an **approved** member of that club —
this is a transfer, not an invitation. Multiple owners are not introduced by this cycle.

### 6.4 Search and pagination

`/admin` currently does an unbounded `db.select().from(clubs)`. Every list page in this
cycle — clubs, users, audit — takes a search term and a page, and none may issue an
unbounded select.

## 7. Deferred

- Inviting an owner who has no account yet (invitation token + email).
- Impersonation, now that `acting_as_role` can finally express `admin`.
- Manual ban / unban and manual penalty issuance. The audit confirmed banning exists
  **only** as a side effect of `markNoShow`, and lifting only via `undoNoShow`. That is the
  penalty-admin backlog item, and it belongs with attendance, not here.
- Club deletion.

## 8. Testing

- Unit: `decideClubRequest` rejects a non-pending club; `setClubStatus` refuses `pending`
  and `rejected`; `setPlatformAdmin` refuses self-revoke and last-admin revoke.
- Integration: rejecting a club frees its slug for a new request, **and `getClubBySlug`
  returns the live club, not the rejected one** — the §5.2 trap, asserted directly.
- Integration: `transferOwnership` leaves exactly one owner, and refuses a target who is
  not an approved member.
- Integration: for each audited mutation, a failure inside the transaction leaves **no**
  audit row (proves atomicity, not just presence).
- Component: the audit viewer renders a row whose actor and club are both null.
- A message-key parity check between `messages/en.json` and `messages/tr.json`, since this
  cycle adds a large number of keys at once.
