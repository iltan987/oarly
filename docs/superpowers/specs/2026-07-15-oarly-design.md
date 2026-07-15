# Oarly — Product & Technical Design Spec

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-15 (rev. 2 — boats, skill levels, concurrency, KVKK)
**Author:** brainstormed with the product owner

Oarly is a multi-club SaaS that helps rowing clubs manage session appointments. It handles
scheduling, boats and skill-level eligibility, capacity, waitlists, cancellations, no-show penalties,
MultiSport-card priority rules, and a special admin pre-reservation feature. **No payments in the app**
— all payment happens in person at the club before the activity.

---

## 1. Scope

> **On the "v1" label:** this is a complete first release, not a thin MVP. The product's value lives in
> the interlocked booking loop (boat/skill eligibility + capacity + waitlist + auto-promotion +
> MultiSport priority + no-show penalties), which can't be shipped in halves and needs auth,
> multi-tenancy, and scheduling underneath it. What is genuinely optional (payments, dues/packages,
> reminders) is deferred to the **Post-v1 Roadmap** (§19).

### In scope (v1)
- Multi-club platform with three roles: **admin** (platform), **owner** (per club), **member** (per club).
- Club onboarding (admin-created, optionally admin-configured; or owner-requested).
- Member accounts that can belong to **multiple clubs**.
- **Boats & skill levels:** club-defined boat types (seat count = capacity) and ordered skill levels;
  per-boat eligibility by minimum skill level and by allowed payment type.
- Owner setup: working days, time windows, which boats run in each window, session length (with
  per-session override), booking-open lead, cancellation policy, no-show penalty, advisory minimum
  attendance, holiday behavior, public profile.
- Booking engine: per-boat capacity, waitlist with **automatic promotion**, MultiSport payment choice
  with two club-selectable priority modes, eligibility gating.
- **Concurrency-safe booking** guaranteeing exactly `capacity` seats under the opening rush (§10).
- Admin **hidden pre-reservation** of a future session.
- Global holiday calendar (admin-managed, Turkish national holidays), per-club overrides.
- Notifications via email (booking confirmation + calendar invite, waitlist promotion, cancellation).
- **Email verification** at sign-up (Google logins are already verified) and **rate-limiting /
  anti-abuse** on auth and booking endpoints.
- **KVKK compliance** (Turkey's data-protection law): explicit consent at sign-up, privacy policy,
  member data export, and account deletion.
- i18n (Turkish default + English), light/dark theme.

### Out of scope (v1)
- In-app payments or MultiSport card validation (payment is in person; the app records the chosen
  payment type only). → §19
- **Memberships / dues / session packages** (pay for N sessions up front, owner assigns credits). → §19
- Physical boat *inventory* tracking (individual hull maintenance/serials). v1 configures boat *types*
  and how many run per slot; it does not track named physical hulls.
- Recurring/all-clubs holidays beyond Turkish national holidays.
- Native mobile apps (responsive web only).
- Session reminders — **stretch goal** (§13), cut if Vercel cron constraints make them costly.
- Freed-seat "hold for a few minutes" grace period — **deferred** (conflicts with instant auto-promotion).

---

## 2. Roles & Tenancy

| Role | Scope | Key abilities |
|------|-------|---------------|
| **Admin** | Platform-wide (global flag on the user) | Create/activate/suspend clubs, optionally pre-fill a club's setup, manage the global holiday calendar, place hidden pre-reservations. |
| **Owner** | One club (membership role) | Full club configuration (boats, skill levels, schedule, policies), open/close slots and sessions, approve join requests, assign member skill levels, mark attendance/no-shows, manage public profile. |
| **Member** | Per club (membership role) | Book/cancel a seat in a boat, join waitlists, choose payment type per booking, manage profile. |

- **Admin** is a global attribute of a user account (not tied to a club).
- **Owner** and **member** are roles held *within* a club, expressed as membership rows. One person can
  be a member of several clubs and an owner of others.

---

## 3. Onboarding

### Club creation (admin-first)
- **Primary path:** admin creates the club and may **optionally pre-fill the setup** (boats, skill
  levels, schedule, policies) on the owner's behalf, then assigns an owner.
- **Secondary path:** an owner submits a **club request**; admin reviews and **activates** it.
- Owners can edit configuration at any time. Club lifecycle: `pending` → `active` → (`suspended`).

### Member join
- A member opens `{club-slug}.oarly.sbs` (or enters a **club code**), then **requests to join**. The
  owner **approves** before the member can book. A single account may join and switch between
  **multiple clubs**.
- Membership status: `pending` → `approved` → (`banned` while a penalty is active) / `rejected`.
- On approval (or later), the owner assigns the member's **skill level** for that club. Until set, the
  member is at the lowest level and can only book boats with no skill requirement.

---

## 4. Domains & Routing

- **Canonical club URL:** `{club-slug}.oarly.sbs` (subdomain per club).
- `oarly.sbs/{club-slug}` **301-redirects** to the canonical subdomain.
- `oarly.sbs` — marketing/landing + platform entry. Admin console at `oarly.sbs/admin`.
- Requires a **wildcard domain** `*.oarly.sbs` on Vercel (and `*.ica2.xyz` for staging).
- **Middleware** resolves the club from the `Host` header and injects the tenant into the request.
- **Auth cookie domain is `.oarly.sbs`** so a member stays authenticated across subdomains.
- **Local dev:** `{slug}.localhost:3000` or `lvh.me`.

### SEO & indexing (decided)
Subdomains are the right call for a multi-tenant SaaS (tenant isolation, branding), even though
subdirectories consolidate domain authority better — because Oarly's **indexable surface is tiny**:
almost everything is behind auth. Best-practice hygiene:
- **Indexable pages only:** the apex marketing/landing (`oarly.sbs`), each **club public/join page**
  (`{slug}.oarly.sbs`), and the **privacy/KVKK page**. Everything authenticated (member app, owner and
  admin consoles) is `noindex, nofollow`.
- **Canonical:** each indexable page carries a self-referential `rel=canonical` to its **subdomain**
  URL; `oarly.sbs/{slug}` 301-redirects to the subdomain, so there is no duplicate content to resolve.
- **hreflang:** TR/EN language alternates via Next.js Metadata `alternates.languages`.
- **Per-club metadata:** title, description, Open Graph tags derived from the club profile; per-club
  `robots.txt` and `sitemap.xml` via route handlers.
- The **apex marketing site** holds brand authority; club subdomains are shareable landing pages
  reached mainly via a direct link, not organic search, so non-consolidated subdomain authority is a
  non-issue here.

---

## 5. Time Handling

- **Store all timestamps in UTC.** Display in the club's timezone, a per-club setting defaulting to
  `Europe/Istanbul`. Turkey is fixed at **UTC+3, no DST since 2016**, so v1 has no DST edge cases;
  parameterizing by club timezone future-proofs non-Turkish clubs at near-zero cost.

---

## 6. Scheduling

The schedule is a recurring **template** that a job **materializes** into concrete, bookable rows.

### Concepts
- **Time window** — a recurring block on a weekday (e.g. Mon `08:00–11:00`, and separately `18:00–20:00`).
- **Window boats** — for each window, the owner sets which **boat types** run and **how many** of each
  (e.g. the 08:00–11:00 window runs 1 Quad + 1 Double).
- **Slot** — a concrete tiled time range on a date (the window's session length tiles the window:
  1h → `08–09`, `09–10`, `10–11`). A slot is the "time offering" members see and the unit that
  **opens for booking**.
- **Session (boat-session)** — one bookable boat within a slot. Its **capacity = the boat type's seat
  count** (overridable per session), and it carries the boat's eligibility rules (§7). A slot with one
  configured boat has exactly one session (no boat picker for the member); a slot with several boats
  has several sessions the member chooses between.

### Generation
- A nightly job materializes **slots** and their **sessions** from windows + window-boats over the
  rolling horizon (far enough to cover the maximum booking-open lead), applying holiday rules (§12).
- The owner can **override** individual slots/sessions: change length/boundaries, capacity, minimum
  attendance, or manually **open/close/cancel**. Overrides are preserved when the generator re-runs.

### Booking-open
- Per club: **always open**, or a **lead** of N days/weeks before the slot start. A slot's `status`
  moves `scheduled` → `open` (booking-open reached) → closed at start. A cron flips slots to `open`;
  opening triggers **pre-reservation reveal** and a seating recompute (§9). The owner can also open/close
  a slot or an individual session manually.

---

## 7. Boats, Skill Levels & Eligibility

### Skill levels (club-defined)
- Each club defines its own **ordered** levels (e.g. `Novice (1) < Intermediate (2) < Advanced (3)`).
- The **owner assigns** each member's level for that club (members cannot self-declare). Level is
  **per-club** — a member can be Advanced at one club and Novice at another.
- New members default to the **lowest / unset** level until the owner sets it.

### Boat types (club-defined)
Each boat type has:
- `name` (e.g. "Quad", "Double", "Single") and `seats` (the session capacity, e.g. 4 / 2 / 1).
- **Minimum skill level** (optional) — the lowest level allowed to book it. Null = no requirement.
- **Allowed payment types** — `regular_only` | `multisport_only` | `both`. This is how "MultiSport can
  only use the 4-person boat, not the 2-person" is expressed (2-person = `regular_only`).
- **Advisory minimum attendance** (optional) — the "need 2–3 to run" number (see below).

### Eligibility check (at booking time)
A member may book a seat in a session only if **all** hold:
1. Membership is `approved` and not `banned`.
2. The member's skill-level rank ≥ the boat type's minimum skill level (or the boat has none).
3. The booking's chosen payment type is permitted by the boat's allowed payment types.

If any fails, the UI shows the booking disabled **with the reason** ("Requires Intermediate",
"MultiSport not allowed on this boat"). Eligibility gates *who can compete*; §8/§9 then order the
eligible bookers within capacity.

### Advisory minimum attendance
- A per-session minimum (defaulting from the boat type, overridable). **Advisory only** — the system
  never auto-cancels. The owner sees which upcoming sessions are **below minimum** (an indicator on the
  schedule and a filtered view) and decides what to do manually.

---

## 8. MultiSport & Payment

- MultiSport = the fitness benefit card (Gympass-style). The app **records** the chosen payment type
  only; it does not validate cards or take money.
- Each member has a **default payment preference** (`regular` | `multisport`), set at registration or in
  settings, and can **override per booking** (subject to the boat's allowed payment types, §7).
- Each club chooses a **MultiSport mode**:
  - **Equal** — regular and MultiSport bookings compete equally, first-come-first-served.
  - **Priority** — regular bookings have priority; MultiSport only occupies seats left over after
    regulars, and can be **displaced** to the waitlist if regulars later fill the session.

---

## 9. Booking Engine

A single deterministic **seating function** decides, per **session (boat)**, who is seated and who is
waitlisted. It runs transactionally on every change (new booking, cancellation, slot open,
pre-reservation reveal) and is protected by the concurrency controls in §10.

### Seating function (per session)
1. Take all active bookings for the session (`booked` or `waitlisted`) — all already passed eligibility.
2. Sort by `(priority_rank, effective_at)`:
   - **Equal mode:** every booking `priority_rank = 0`.
   - **Priority mode:** regular = `0`, MultiSport = `1`.
   - `effective_at` = booking creation time (see §11 for the pre-reservation exception).
3. The top `capacity` are **seated**; the rest **waitlisted** with a `queue_position`.
4. Displacement falls out naturally: in Priority mode a late **regular** outranks an earlier
   **MultiSport**, pushing it to the waitlist.

### Waitlist auto-promotion
- When a seated booking is cancelled, the seating function recomputes; any booking moving
  waitlisted → seated is **automatically registered (no confirmation)** and the member is emailed. A
  displaced MultiSport member (Priority mode) is emailed a neutral "moved to waitlist" notice.

### Cancellation
- The owner can **enable/disable member self-cancellation** and set a **cutoff** (e.g. no cancel within
  8h / 1 day of start). The owner can always cancel on a member's behalf.

### No-show & penalties
- After a session, the owner opens its **roster** and marks each booking `attended` or `no_show`.
- A `no_show` triggers the club's configured **penalty**: ban for `2 days` / `1 week` / `2 weeks` /
  `1 month` / `never` (permanent) / `off`. A ban sets `membership.banned_until`; a banned member cannot
  book until it lifts (evaluated at booking time — no cron needed).

---

## 10. Concurrency & Correctness (the opening rush)

When a slot opens, ~20–25 members hit it within seconds across many Vercel function instances. **The
guarantee that exactly `capacity` get in comes from the database, not the app.**

- **Serialize per session.** Inside the booking transaction, acquire a **Postgres advisory lock keyed
  by `session_id`** (`pg_advisory_xact_lock`), or `SELECT … FOR UPDATE` the session row. Concurrent
  requests for that session queue behind the lock and are decided one at a time in arrival order: count
  seated bookings → seat if `< capacity`, else waitlist. **No overbooking is possible**, and the
  outcome is deterministic.
- **No duplicate seats.** A unique partial index on `(session_id, user_id)` for active statuses
  (`booked`,`waitlisted`) — a member cannot hold two seats even under a double-submit.
- **Idempotency.** Each booking submit carries an idempotency key; a retry returns the original result
  instead of creating a second booking.
- **Rate-limiting / anti-abuse.** Per-account and per-IP limits on auth and booking endpoints blunt
  retry storms and duplicate-account gaming (upstash/redis-style limiter at the edge).
- **"First N" under Priority mode** means the N highest by `(priority, arrival)`; the same locked
  recompute enforces MultiSport displacement deterministically.
- Neon/Postgres handles this comfortably at this scale; Fluid Compute's instance concurrency does not
  threaten correctness because the DB is the single source of truth.

---

## 11. Admin Hidden Pre-Reservation

- The admin places a pre-reservation on a **future session before its slot opens**. It is **invisible to
  the owner and members** until the slot opens.
- Fields: target session (boat + slot), **who it's for** (a named member / free-text guest / the admin),
  and a **payment type** (must satisfy the boat's allowed payment types).
- On slot **open**, it **materializes into a real booking** with `effective_at` = open moment *minus
  epsilon* — front of its payment-type queue, ahead of the public rush — and a **random `slot_index`**
  within capacity (cosmetic, so it doesn't always display as "booking #1").
- Priority rules still apply: **regular-type → effectively guaranteed**; **MultiSport-type in Priority
  mode → only holds if regulars don't fill the session** (can be displaced).
- Modeled as a `booking` with `source = admin_prereservation` and `hidden = true` until reveal.

---

## 12. Holidays

- The admin **auto-generates ~1 year of Turkish national holidays** (via a holiday library such as
  `date-holidays`), then **reviews and approves** them. Holidays are a **global** list.
- Each club sets **"open on holidays?"** and can **override specific dates** (force-open / force-close).
- The generator (§6) consults approved holidays + per-club overrides when materializing slots.
- v1: **national holidays only.**

---

## 13. Notifications

Email via **Resend**; each template in TR and EN (member's locale).

| Notification | Trigger | Notes |
|--------------|---------|-------|
| **Booking confirmation** | Booking seated | **.ics attachment** + **Google Calendar link** (includes boat + time). |
| **Waitlist promotion** | Auto-promoted to seated | "You're in!" — no action needed. |
| **Displaced to waitlist** | MultiSport bumped in Priority mode | Neutral tone. |
| **Cancellation confirmation** | Member or owner cancels | — |
| **Session reminder** *(stretch)* | Configurable time before start | Hourly Vercel Cron scan; **cut if cron cost is a problem** (hourly crons typically need Vercel **Pro**). |

A `notifications` log gives idempotency (never send twice).

---

## 14. KVKK / Data Protection

Turkey's KVKK (≈ GDPR) is a **legal** requirement, in v1:
- **Consent at sign-up:** explicit acceptance of the privacy policy / clarification text (aydınlatma
  metni) and consent to processing, recorded with document version + timestamp.
- **Privacy policy / clarification page** (TR + EN), publicly reachable.
- **Data export:** a member can download their personal data.
- **Account deletion:** a member can delete their account (or request deletion), with defined handling of
  historical bookings (anonymize rather than break referential history).
- Store only what's needed; personal fields (birthday, gender, socials) remain optional.

### Retention policy (decided)
Aligned with KVKK's "retain only as long as necessary" principle and the Regulation on Deletion,
Destruction or Anonymization of Personal Data:
- **On deletion request:** personal data is **anonymized within 30 days** (auth identity, profile,
  contact, optional fields). Auth sessions/tokens are purged **immediately**.
- **Bookings** are **anonymized, not deleted** — `user_id` detached, personal fields stripped — so
  attendance/no-show history and club statistics stay intact. Anonymized (non-personal) records may be
  kept indefinitely.
- **Consent records** (KVKK proof) are retained for the duration of the legal obligation, then
  destroyed in a **periodic destruction cycle (max 6 months)** after the obligation ends.
- These are sensible defaults; a lawyer should confirm before launch (flagged, not a blocker).

---

## 15. Internationalization & Theming

- **i18n:** `next-intl`. **Turkish default**, English included. Detect from device (`Accept-Language`),
  fall back to Turkish.
- **Theme:** light/dark via `next-themes` (class strategy), follows system by default with a manual
  toggle. Every screen must render correctly in both.

---

## 16. Accounts & Profile

- **Auth:** Better Auth — email/password + Google, with password reset and change-password, and
  **email verification** for email/password sign-ups (Google emails are pre-verified).
- **Required at registration:** first name, last name, phone, email; KVKK consent (§14).
- **Optional:** birthday, gender, social handles (e.g. Instagram).
- **Preferences:** default payment type, locale, theme.
- **Club public profile (owner-managed):** name, logo, phone (optional), socials (optional).

---

## 17. Technical Architecture

- **Framework:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4. **UI:** shadcn/ui.
- **Auth:** Better Auth (identity only). Authorization (admin/owner/member) in our own tables.
- **DB:** Neon Postgres (Vercel Marketplace), **Drizzle ORM**. **Email:** Resend.
- **Hosting:** Vercel (Fluid Compute); middleware for tenant resolution.
- **Rate-limiting:** edge limiter backed by a Redis-style store (e.g. Upstash via Marketplace).
  Default thresholds (tunable in one config):
  - **Login:** 5 failed attempts / 15 min per account (then exponential backoff), 20 / min per IP.
  - **Sign-up:** 5 / hour per IP. **Password reset / verify resend:** 3 / hour per email, 10 / hour per IP.
  - **Booking submit:** 10 / min per account, 60 / min per IP (idempotency, §10, absorbs the legitimate
    double-taps of the rush; this only stops scripted spam).
  - **General API baseline:** 100 / min per IP.
- **Cron (Vercel):** nightly slot/session generation; frequent (few minutes) slot-open + pre-reservation
  reveal + seating recompute; hourly reminders *(stretch)*.
- **Time:** store UTC; render in club timezone (`Europe/Istanbul` default).

### Data model sketch (Drizzle / Postgres)

Better Auth manages identity tables (`user`, `account`, `session`, `verification`). App tables reference
the Better Auth `user.id`.

- **users** *(profile)* — `id`, `first_name`, `last_name`, `phone`, `email`, `birthday?`, `gender?`,
  `default_payment_type` (`regular`|`multisport`), `locale`, `theme`, `is_admin`, `created_at`.
  Socials in **user_socials** (`user_id`, `platform`, `handle`).
- **consents** *(KVKK)* — `id`, `user_id`, `document`, `version`, `accepted_at`.
- **clubs** — `id`, `slug` (unique), `name`, `logo_url?`, `phone?`, `timezone` (default `Europe/Istanbul`),
  `status` (`pending`|`active`|`suspended`), `multisport_mode` (`equal`|`priority`),
  `booking_open_mode` (`always`|`lead`), `booking_open_lead_days?`,
  `self_cancel_enabled`, `cancel_cutoff_hours?`,
  `noshow_penalty` (`off`|`2d`|`1w`|`2w`|`1m`|`never`), `open_on_holidays`, `created_by`, `created_at`.
  Socials in **club_socials**.
- **memberships** — `id`, `user_id`, `club_id`, `role` (`owner`|`member`),
  `status` (`pending`|`approved`|`rejected`|`banned`), `banned_until?`, `skill_level_id?`, `joined_at`.
- **skill_levels** — `id`, `club_id`, `name`, `rank` (int, ordering).
- **boat_types** — `id`, `club_id`, `name`, `seats`, `min_skill_level_id?`,
  `allowed_payment` (`regular_only`|`multisport_only`|`both`), `min_attendance?`, `active`.
- **schedule_windows** — `id`, `club_id`, `weekday` (0–6), `start_time`, `end_time`,
  `default_session_minutes`.
- **window_boats** — `id`, `window_id`, `boat_type_id`, `quantity`.
- **slots** — `id`, `club_id`, `date`, `start_at` (UTC), `end_at` (UTC), `from_window_id?`,
  `status` (`scheduled`|`open`|`closed`|`cancelled`).
- **sessions** *(boat-session)* — `id`, `slot_id`, `club_id`, `boat_type_id`, `capacity`,
  `min_attendance?`, `status` (`open`|`closed`|`cancelled`), `is_override`.
- **bookings** — `id`, `session_id`, `club_id`, `user_id?` (null for guest),
  `payment_type` (`regular`|`multisport`),
  `status` (`booked`|`waitlisted`|`cancelled`|`no_show`|`attended`),
  `queue_position?`, `slot_index?`, `effective_at`,
  `source` (`member`|`owner`|`admin_prereservation`), `hidden`, `guest_name?`,
  `idempotency_key?`, `created_at`.
  *Unique partial index* on `(session_id, user_id)` where `status in ('booked','waitlisted')`.
- **penalties** *(audit)* — `id`, `membership_id`, `session_id`, `reason`, `banned_until`, `created_at`.
- **holidays** *(global)* — `id`, `date`, `name`, `source` (`auto`|`manual`),
  `status` (`pending`|`approved`), `year`.
- **club_holiday_overrides** — `club_id`, `date`, `is_open`.
- **notifications** *(log)* — `id`, `user_id`, `type`, `session_id?`, `sent_at`.

---

## 18. Key Invariants & Edge Cases

- **Eligibility** is enforced server-side at booking time (skill + payment-type + membership state),
  never trusted from the client.
- **Exactly `capacity`** per session under load, via §10 (advisory lock + unique index + idempotency).
- **Banned members** cannot book (checked against `banned_until`).
- **Cancellation cutoff** blocks self-cancel inside the window; owner override always allowed.
- **Seating recompute** is transactional and idempotent.
- **Hidden pre-reservations** never appear to owner/members before reveal (queries filter `hidden`).
- **Guest bookings** have `user_id = null`, `guest_name` set, no email.
- **Auto-promotion** never asks for confirmation; it registers and emails.
- **Boat picker** only appears when a slot has more than one boat-session.
- **Minimum attendance** is advisory: surfaced to the owner, never enforced automatically.
- **Account deletion** anonymizes historical bookings rather than breaking referential history.

---

## 19. Post-v1 Roadmap

**Deferred from v1 (already designed around)**
- **In-app payments** + MultiSport card validation.
- **Memberships / dues / session packages** — pay for N sessions up front; owner assigns/spends credits.
- **Session reminders** (stretch; frequent Vercel Cron, typically Pro).
- Freed-seat **hold-grace** on cancellation.
- Multi-country **timezone/holiday** support.
- Physical **boat inventory** (named hulls, maintenance, serials).

**New capabilities (not yet scoped)**
- **Owner announcements / broadcast** — likely **WhatsApp/SMS** in Turkey, not just email.
- **Owner analytics** — attendance %, no-show rates, utilization, busiest times.
- **Coach/instructor role** + assigning a coach to sessions; **multiple staff per club**.
- **Recurring bookings** ("every Tuesday 08:00").

---

## 20. Decisions Log (previously open)

All prior open questions are resolved:
- **Rate-limiting thresholds** — decided; see §17 (tunable defaults).
- **KVKK deletion retention** — decided; see §14 (anonymize personal data within 30 days, retain
  anonymized bookings, consent records destroyed in ≤6-month cycles). Lawyer to confirm pre-launch.
- **Multiple boats of the same type per slot** — **yes**; each is its own session with an independent
  waitlist (§6, §7).
- **Subdomain vs. path SEO** — decided; subdomain canonical with a small indexable surface,
  self-referential canonicals, hreflang, and `noindex` on the authenticated app (§4).

The only remaining pre-launch external check is **legal sign-off on the KVKK texts and retention
policy** — a review item, not a design gap.
