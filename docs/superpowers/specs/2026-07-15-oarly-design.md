# Oarly — Product & Technical Design Spec

**Status:** Approved design (pre-implementation)
**Date:** 2026-07-15
**Author:** brainstormed with the product owner

Oarly is a multi-club SaaS that helps rowing clubs manage session appointments. It handles
scheduling, capacity, waitlists, cancellations, no-show penalties, MultiSport-card priority
rules, and a special admin pre-reservation feature. No payments are handled in the app — all
payment happens in person at the club before the activity.

---

## 1. Scope

> **On the "v1" label:** this is a complete first release, not a thin MVP. The product's value lives
> entirely in the interlocked booking loop (capacity + waitlist + auto-promotion + MultiSport priority
> + no-show penalties), which can't be shipped in halves and needs auth, multi-tenancy, and scheduling
> underneath it. What is genuinely optional (payments, reminders) is deferred to the **Post-v1 Roadmap**
> (§16).

### In scope (v1)
- Multi-club platform with three roles: **admin** (platform), **owner** (per club), **member** (per club).
- Club onboarding (admin-created, optionally admin-configured; or owner-requested).
- Member accounts that can belong to **multiple clubs**.
- Owner setup: working days, time windows, session length (with per-session override), capacity,
  booking-open lead, cancellation policy, no-show penalty, holiday behavior, public profile.
- Booking engine: capacity, waitlist with **automatic promotion**, MultiSport payment choice with
  two club-selectable priority modes.
- Admin **hidden pre-reservation** of a future session.
- Global holiday calendar (admin-managed, Turkish national holidays), per-club overrides.
- Notifications via email (booking confirmation + calendar invite, waitlist promotion, cancellation).
- **Email verification** at sign-up, and **basic rate-limiting / anti-abuse** on auth and booking
  endpoints (the 20–25-person rush is where duplicate-account gaming and abuse surface).
- i18n (Turkish default + English), light/dark theme.

### Out of scope (v1)
- In-app payments or MultiSport card validation (payment is in person; the app only records the
  chosen payment type). → §16
- Recurring/all-clubs holidays beyond national holidays.
- Native mobile apps (responsive web only).
- Session reminders are a **stretch goal** (see §11), cut if Vercel cron constraints make them costly.
- Freed-seat "hold for a few minutes" grace period — **deferred** (conflicts with instant auto-promotion).
- Boat/equipment management — **not built in v1**, but the session/capacity model is kept boat-ready
  (see §6 and §16) so adding it later is not a rewrite.

---

## 2. Roles & Tenancy

| Role | Scope | Key abilities |
|------|-------|---------------|
| **Admin** | Platform-wide (global flag on the user) | Create/activate/suspend clubs, optionally pre-fill a club's setup, manage the global holiday calendar, place hidden pre-reservations. |
| **Owner** | One club (membership role) | Full club configuration, open/close sessions, approve join requests, mark attendance/no-shows, manage public profile. |
| **Member** | Per club (membership role) | Book/cancel sessions, join waitlists, choose payment type per booking, manage profile. |

- **Admin** is a global attribute of a user account (not tied to a club).
- **Owner** and **member** are roles held *within* a club, expressed as membership rows. One person
  can be a member of several clubs and an owner of others.

---

## 3. Onboarding

### Club creation (admin-first)
- **Primary path:** admin creates the club and may **optionally pre-fill the setup wizard** on the
  owner's behalf (for non-technical owners), then assigns an owner. The owner receives a
  ready-to-use club.
- **Secondary path:** an owner submits a **club request**; admin reviews and **activates** it.
- Owners can edit their configuration at any time after activation.
- A club has a lifecycle status: `pending` → `active` → (`suspended`).

### Member join
- A member opens a club's public link `{club-slug}.oarly.sbs` (or enters a **club code**), then
  **requests to join**. The club **owner approves** the request before the member can book.
- A single member account may join and switch between **multiple clubs**.
- Membership status: `pending` → `approved` → (`banned` while a penalty is active) / `rejected`.

---

## 4. Domains & Routing

- **Canonical club URL:** `{club-slug}.oarly.sbs` (subdomain per club).
- `oarly.sbs/{club-slug}` **301-redirects** to the canonical subdomain, so both forms work but a
  single canonical URL avoids duplicate content.
- `oarly.sbs` — marketing/landing + platform entry. Admin console at `oarly.sbs/admin`.
- Requires a **wildcard domain** `*.oarly.sbs` on Vercel (and `*.ica2.xyz` for staging).
- **Middleware** resolves the club from the `Host` header and injects the tenant into the request.
- **Auth cookie domain is `.oarly.sbs`** so a logged-in member stays authenticated across subdomains.
- **Local dev:** `{slug}.localhost:3000` (modern browsers resolve `*.localhost`) or `lvh.me`.

---

## 5. Time Handling

- **Store all timestamps in UTC.**
- **Display in the club's timezone**, a per-club setting defaulting to `Europe/Istanbul`.
- Turkey is fixed at **UTC+3 with no daylight-saving since 2016**, so v1 has no DST edge cases.
  Parameterizing display by club timezone future-proofs non-Turkish clubs at near-zero cost.

---

## 6. Scheduling

### Recurring template (windows)
- The owner defines **working days** and, per day, **one or more time windows**
  (e.g. Mon–Fri `08:00–11:00` and `18:00–20:00`).
- Each window has a **default session length** that tiles the window into equal sessions
  (1h → `08–09`, `09–10`, `10–11`).
- Each window has a **default capacity**.

### Concrete sessions (materialized)
- A nightly **generation job** materializes concrete `session` rows from the windows for the rolling
  horizon (far enough ahead to cover the maximum booking-open lead), applying holiday rules (§9).
- The owner can **override** individual sessions: change length/boundaries, capacity, or manually
  **open/close/cancel** a session. Overrides are preserved when the generator runs again.
- **Boat-ready (not built in v1):** `capacity` is a plain integer for now. Boat/equipment management
  (§16) would later let capacity *derive* from an assigned boat (single=1, double=2, quad=4, eight=8).
  Keep `capacity` authoritative on the session so a future `boat_id` can populate it without a rewrite.

### Booking-open
- Configurable per club:
  - **Always open** — sessions are bookable as soon as they exist.
  - **Lead** — sessions become bookable N days/weeks before their start.
- A session's `status` progresses `scheduled` → `open` (when booking-open time is reached) →
  effectively closed at start. A cron flips sessions to `open`; opening triggers **pre-reservation
  reveal** and a seating recompute (§8).

---

## 7. MultiSport & Payment

- MultiSport = the fitness benefit card (e.g. Gympass-style). The app **records** the chosen payment
  type only; it does not validate cards or take money.
- Each member has a **default payment preference** (`regular` | `multisport`) set at registration or
  in settings, and can **override it per booking**.
- Each club chooses a **MultiSport mode**:
  - **Equal** — regular and MultiSport bookings compete equally, first-come-first-served.
  - **Priority** — regular bookings have priority; MultiSport bookings only occupy seats left over
    after regulars, and can be **displaced** to the waitlist if regulars later fill the session.

---

## 8. Booking Engine

The heart of the system. A single deterministic **seating function** decides, for any session, who is
seated and who is waitlisted. It is recomputed transactionally on every change (new booking,
cancellation, session open, pre-reservation reveal).

### Seating function
1. Take all active bookings for the session (`booked` or `waitlisted`).
2. Sort by `(priority_rank, effective_at)`:
   - **Equal mode:** every booking has `priority_rank = 0`.
   - **Priority mode:** regular = `0`, MultiSport = `1`.
   - `effective_at` = the booking's creation time (see pre-reservations for the exception).
3. The top `capacity` bookings are **seated**; the rest are **waitlisted** with a `queue_position`.
4. Displacement falls out naturally: in Priority mode a late **regular** outranks an earlier
   **MultiSport**, pushing the MultiSport booking to the waitlist.

### Waitlist auto-promotion
- When a seated booking is cancelled, the seating function is recomputed; any booking that moves from
  waitlisted → seated is **automatically registered (no confirmation step)** and the member receives a
  promotion email.

### Cancellation
- The owner can **enable/disable member self-cancellation** and set a **cutoff** (e.g. no cancel within
  8h / 1 day of the session start). The owner can always cancel on a member's behalf.

### No-show & penalties
- After a session, the owner opens its **roster** and marks each booking `attended` or `no_show`.
- A `no_show` triggers the club's configured **penalty**: ban for `2 days` / `1 week` / `2 weeks` /
  `1 month` / `never` (permanent) / `off` (no penalty).
- A ban sets `membership.banned_until`; a banned member cannot book until it lifts. Ban state is
  evaluated at booking time (no cron needed).

---

## 9. Admin Hidden Pre-Reservation

The signature feature: the admin guarantees a seat on a busy future session before the public rush.

- The admin places a pre-reservation on a **future session before booking opens**. It is **invisible to
  the owner** (and members) until that session opens.
- Fields: target session, **who it's for** (a named member / free-text guest / the admin), and a
  **payment type** (`regular` | `multisport`).
- When the session **opens**, the pre-reservation **materializes into a real booking** and participates
  in the seating function with an `effective_at` set to the open moment *minus epsilon* — placing it at
  the front of its payment-type queue, ahead of the public rush.
- It also receives a **random `slot_index`** within capacity — purely cosmetic (so it doesn't always
  display as "booking #1").
- Priority rules still apply:
  - **Regular-type pre-reservation → effectively guaranteed** (front of the regular queue).
  - **MultiSport-type in Priority mode → only holds if regulars don't fill the session**; it can be
    displaced like any MultiSport booking.
- Modeled as a `booking` row with `source = admin_prereservation` and `hidden = true` until reveal.

---

## 10. Holidays

- The admin **auto-generates ~1 year of Turkish national holidays** (via a holiday library such as
  `date-holidays`), then **reviews and approves** them. Holidays are a **global** list.
- Each club sets **"open on holidays?"** and can **override specific dates** (force-open or force-close).
- The session generator (§6) consults approved holidays + per-club overrides when materializing sessions.
- v1: **national holidays only.**

---

## 11. Notifications

Email via **Resend**. Each has a template in both TR and EN (member's locale).

| Notification | Trigger | Notes |
|--------------|---------|-------|
| **Booking confirmation** | Successful booking (seated) | Includes **.ics attachment** + **Google Calendar link**. |
| **Waitlist promotion** | Auto-promoted from waitlist to seated | "You're in!" — no action needed. |
| **Cancellation confirmation** | Member or owner cancels | — |
| **Session reminder** *(stretch)* | Configurable time before start | Requires hourly Vercel Cron scanning upcoming sessions. **Cut if cron constraints make it costly.** Note: hourly crons typically need Vercel **Pro**; Hobby cron cadence is limited. |

- A `notifications` log table gives idempotency (don't send twice).

---

## 12. Internationalization & Theming

- **i18n:** `next-intl`. **Turkish is the default**; English is included. Detect from the device via
  `Accept-Language`; fall back to Turkish.
- **Theme:** light/dark via `next-themes` (class strategy). Follows the system by default with a manual
  toggle. All components must render correctly in both themes.

---

## 13. Accounts & Profile

- **Auth:** Better Auth — email/password + Google, with password reset and change-password flows.
- **Required at registration:** first name, last name, phone, email.
- **Optional:** birthday, gender, social handles (e.g. Instagram).
- **Preferences:** default payment type (`regular`/`multisport`), locale, theme.
- **Club public profile (owner-managed):** name, logo, phone (optional), socials like Instagram (optional).

---

## 14. Technical Architecture

- **Framework:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4.
- **UI:** shadcn/ui for accessible, themeable primitives.
- **Auth:** Better Auth (identity only: email/password + Google + reset/change). Authorization
  (owner/member/admin) lives in our own tables, not an auth-provider org model.
- **DB:** Neon Postgres (via Vercel Marketplace), **Drizzle ORM**.
- **Email:** Resend.
- **Hosting:** Vercel (Fluid Compute). Middleware for tenant resolution.
- **Cron (Vercel):**
  - Nightly: session generation from windows over the rolling horizon.
  - Frequent (e.g. every few minutes): flip sessions to `open` at their booking-open time + reveal
    pre-reservations + recompute seating.
  - Hourly *(stretch)*: session reminders.
- **Time:** store UTC; render in club timezone (`Europe/Istanbul` default).

### Data model sketch (Drizzle / Postgres)

Better Auth manages its own identity tables (`user`, `account`, `session`, `verification`). Application
tables below reference the Better Auth `user.id`.

- **users** *(app profile, 1:1 with Better Auth user)* — `id`, `first_name`, `last_name`, `phone`,
  `email`, `birthday?`, `gender?`, `default_payment_type` (`regular`|`multisport`), `locale`, `theme`,
  `is_admin` (bool), `created_at`. Social handles in **user_socials** (`user_id`, `platform`, `handle`).
- **clubs** — `id`, `slug` (unique), `name`, `logo_url?`, `phone?`, `timezone` (default `Europe/Istanbul`),
  `status` (`pending`|`active`|`suspended`), `multisport_mode` (`equal`|`priority`),
  `booking_open_mode` (`always`|`lead`), `booking_open_lead_days?`,
  `self_cancel_enabled` (bool), `cancel_cutoff_hours?`,
  `noshow_penalty` (`off`|`2d`|`1w`|`2w`|`1m`|`never`),
  `open_on_holidays` (bool), `created_by`, `created_at`. Socials in **club_socials**.
- **memberships** — `id`, `user_id`, `club_id`, `role` (`owner`|`member`),
  `status` (`pending`|`approved`|`rejected`|`banned`), `banned_until?`, `joined_at`.
- **schedule_windows** — `id`, `club_id`, `weekday` (0–6), `start_time`, `end_time`,
  `default_session_minutes`, `default_capacity`.
- **sessions** — `id`, `club_id`, `date`, `start_at` (UTC), `end_at` (UTC), `capacity`,
  `status` (`scheduled`|`open`|`closed`|`cancelled`), `from_window_id?`, `is_override` (bool).
- **bookings** — `id`, `session_id`, `club_id`, `user_id?` (null for guest),
  `payment_type` (`regular`|`multisport`),
  `status` (`booked`|`waitlisted`|`cancelled`|`no_show`|`attended`),
  `queue_position?`, `slot_index?`, `effective_at`,
  `source` (`member`|`owner`|`admin_prereservation`), `hidden` (bool), `guest_name?`, `created_at`.
- **penalties** *(audit)* — `id`, `membership_id`, `session_id`, `reason`, `banned_until`, `created_at`.
- **holidays** *(global)* — `id`, `date`, `name`, `source` (`auto`|`manual`),
  `status` (`pending`|`approved`), `year`.
- **club_holiday_overrides** — `club_id`, `date`, `is_open` (bool).
- **notifications** *(log/idempotency)* — `id`, `user_id`, `type`, `session_id?`, `sent_at`.

---

## 15. Key Invariants & Edge Cases

- **Banned members** cannot create bookings (checked at booking time against `banned_until`).
- **Cancellation cutoff** blocks self-cancel inside the window; owner override always allowed.
- **Seating recompute** is transactional and idempotent; running it twice yields the same result.
- **Hidden pre-reservations** never appear to owner/members before reveal (queries filter
  `hidden = true` for non-admins).
- **Guest bookings** (admin pre-reservation for a non-member) have `user_id = null`, `guest_name` set,
  and receive no email.
- **Auto-promotion** never asks for confirmation; it registers and emails.
- **Displacement** (Priority mode) can move a previously-seated MultiSport member to the waitlist; that
  member should be notified — *(open question: send a "moved to waitlist" email? Default: yes, reuse a
  neutral template.)*

---

## 16. Post-v1 Roadmap

Ordered roughly by expected value; none are in v1.

**Deferred from v1 (already designed around)**
- **In-app payments** + MultiSport card validation (v1 only records the chosen payment type).
- **Session reminders** (stretch; needs frequent Vercel Cron — typically the Pro plan).
- Freed-seat **hold-grace** on cancellation (conflicts with instant auto-promotion; revisit).
- Multi-country **timezone/holiday** support (v1 is Turkey-only, `Europe/Istanbul`).

**New capabilities (not yet scoped)**
- **Owner announcements / broadcast** — e.g. "no rowing today, storm." Likely wants **WhatsApp/SMS**
  in Turkey, not just email. High value, low cost.
- **Owner analytics** — attendance %, no-show rates, utilization, busiest times.
- **Boat / equipment management** — sessions tied to a boat type (single/double/quad/eight) with seat
  counts; capacity derives from the boat (see §6 boat-ready note). The most rowing-specific feature.
- **Coach/instructor role** + assigning a coach to sessions; **multiple staff per club** (co-owner,
  front desk) beyond the single-owner v1 model.
- **Recurring bookings** ("every Tuesday 08:00").
- **Membership / dues tracking** — who is paid up; session packages (10-pack, monthly) — even without
  in-app payment.
- **Skill levels / eligibility** — beginners cannot book advanced sessions.
- **KVKK compliance** (Turkey's GDPR) — consent capture, data export, account deletion. A *legal*
  workstream; plan even if built minimally.

## 17. Open Questions

- Whether displaced MultiSport members (Priority mode) get a dedicated "moved to waitlist"
  notification. **Default: yes**, reusing a neutral template.
- Subdomain vs. path canonicalization SEO details.
- Exact rate-limiting thresholds for the booking rush (per-account and per-IP).
- Whether **boats** should influence the v1 session model beyond the boat-ready note (current
  decision: no — keep `capacity` a plain integer, add boats post-v1).
