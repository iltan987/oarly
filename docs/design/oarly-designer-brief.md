# Oarly — Designer Brief

**For:** the visual/UX designer producing mockups
**From:** product + engineering
**Date:** 2026-07-15 (rev. 2 — boats, skill levels, KVKK)

This brief describes **what each screen must do, the flows they connect, and the states they must
handle** — so you can design the interface. It deliberately makes **no visual styling decisions**
(color, type, spacing, imagery, brand): those are yours. Where behavior constrains layout, it's noted.

The engineering spec (data model, rules) lives at
`docs/superpowers/specs/2026-07-15-oarly-design.md` — read it for the full logic, but this brief is
self-contained.

---

## 1. What Oarly is

A multi-club web app that lets rowing clubs manage session appointments. A club runs **boats** of
different sizes (e.g. single/1, double/2, quad/4); members book a **seat in a boat** at a given time.
Which boats a member may book depends on their **skill level** and the boat's **allowed payment type**.
Owners run their club; a platform admin oversees everything. **No payments in the app** — members pay
in person at the club.

## 2. Who uses it, and how

- **Members** — book and manage seats, mostly **on a phone**, often **in a rush** the moment a slot
  opens (20–25 people competing for a handful of seats within seconds). Speed and clarity of "am I in,
  waitlisted, or too late?" matter more than anything.
- **Owners** — often **non-technical or older**; run one club. Their tools must be forgiving, guided,
  and hard to misconfigure. Desktop and phone.
- **Admin** — the platform operator (technical). Efficiency over hand-holding.

## 3. Design principles (behavioral, not visual)

- **Mobile-first for members.** The booking moment happens on a phone. Optimize the slot list, the
  **boat choice**, and the book/waitlist action for one-handed, fast use.
- **Guided for owners.** Setup is multi-step and consequential (boats, skill levels, schedule, policies);
  prefer wizards, sensible defaults, inline explanation, confirmation on destructive actions.
- **State legibility.** A seat's status (open, full, waitlisted, booked, **ineligible**, closed) must be
  unmistakable at a glance — including *why* something is ineligible.
- **Two themes, two languages.** Every screen must work in **light and dark**, and in **Turkish
  (default) and English**. Turkish runs longer — leave room; don't design to fixed-width labels.
- **Accessible.** Sufficient contrast in both themes, keyboard operable, clear focus, comfortable touch
  targets.

---

## 4. Global patterns

- **Top-level navigation** per role (member / owner / admin), adapted to mobile and desktop.
- **Club switcher** — a member can belong to **multiple clubs**; fast switching of the active club.
- **Language switcher** and **theme toggle** — from settings and, ideally, the public/auth screens.
- **Empty / loading / error** states for every list and data view.
- **Confirmation & feedback** pattern for actions (booked, cancelled, promoted, saved).
- **Role-aware chrome** — the same person may be a member of one club and owner of another; make the
  current context obvious.
- **Admin "acting as owner" banner** — when an admin impersonates a club owner, a **persistent,
  always-visible banner** ("Acting as [Club] — Exit") sits above the owner UI. Admin drives the *real*
  owner screens (not a duplicate), so design the owner console with room for this banner. Admin
  impersonation is **owner-only** (never member).

---

## 5. Screen inventory

Priority: **P0** = required for a usable v1, **P1** = important, **P2** = nice-to-have.

### A. Public & Auth
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Platform landing** (`oarly.sbs`) | Explain Oarly; entry to sign in / sign up. | Logged-out vs logged-in. | P1 |
| **Club public page** (`{slug}.oarly.sbs`) | A club's front door: name, logo, phone, socials; "Join" CTA. | Not-a-member (Join), pending approval, already a member (enter app). | P0 |
| **Sign up** | Create account. | Required: first/last name, phone, email, password, **KVKK consent** (accept privacy/clarification text — with link). Optional: birthday, gender, socials. Default payment preference. Field-level validation. | P0 |
| **Sign in** | Email/password + **Google**. | Error, loading, **rate-limited ("too many attempts")**. | P0 |
| **Email verification** | Confirm email after email/password sign-up before booking (Google is pre-verified). | Awaiting verification, resend link, verified, expired link. | P0 |
| **Forgot / reset password** | Request + set new password. | Sent, invalid/expired token, success. | P0 |
| **Change password** | From settings. | — | P1 |
| **Privacy / KVKK policy** | Public clarification + privacy text (TR/EN). | — | P0 |
| **Join a club** | Via club link or **club code**. | Submitting, pending owner approval, approved, rejected. | P0 |

### B. Member app
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Slot list / calendar** | Browse a club's upcoming **slots**; each slot shows the **boats** running in it with seats + eligibility. | Per boat-seat: not-yet-open (countdown), open with seats (N left), full (waitlist), booked-by-me, waitlisted-by-me (position), **ineligible** (why: skill/payment), closed/past. **Highest-traffic, most time-critical screen.** | P0 |
| **Slot / boat detail** | Pick a **boat** (if the slot has more than one), choose **payment type** (default pre-selected, changeable, limited by the boat), then book. | Seats remaining, waitlist length/position, booking-open countdown, cancel cutoff, eligibility-blocked with reason, book / join-waitlist / cancel. | P0 |
| **My bookings** | Upcoming + past across the active club. | Booked, waitlisted (position), attended, no-show, cancelled. Cancel honors cutoff. | P0 |
| **Profile & preferences** | Edit profile, default payment type, socials, language, theme. | Saved/error. | P0 |
| **Privacy & data** | **Export my data**, **delete account** (KVKK). | Confirm destructive delete; export ready/download. | P0 |
| **My clubs** | List memberships, switch active club, join another; shows **my skill level** per club. | Approved, pending, banned (until date). | P0 |
| **Banned notice** | Under a no-show penalty. | Reason + when the ban lifts; block booking. | P1 |

### C. Owner console
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Setup wizard** | First-run config (may arrive **pre-filled by admin**). Steps: **skill levels** (define ordered levels) → **boat types** (name, seats, min skill level, allowed payment types, advisory min attendance) → **working days & time windows** → **which boats run in each window** (+ how many) → **session length** (default + override) → **booking-open** (always / N days-weeks) → **cancellation** (on/off + cutoff) → **no-show penalty** → **holidays** → **public profile & brand** (logo, phone, socials, **brand accent color + optional heading font** = the club skin). | Draft/incomplete, pre-filled, saved; each step editable later. | P0 |
| **Skill levels** | Define/reorder the club's levels. | Empty, in-use (can't delete a level assigned to members without reassigning). | P0 |
| **Boat types** | Manage boats: seats, min skill, allowed payment types, advisory minimum. | Active/inactive. | P0 |
| **Schedule manager** | See generated **slots & boats**; **override** length/boundaries/capacity/min; **open/close/cancel** a slot or a single boat. Flag **under-minimum** sessions. | Generated vs overridden; open/closed/cancelled; below-minimum indicator; holiday-affected. | P0 |
| **Session roster** | A session's booked + waitlisted people; after the session **mark attendance / no-show**. | Seated list, ordered waitlist, attendance marking, penalty-applied feedback, below-minimum warning. | P0 |
| **Join requests** | Approve/reject members; optionally set skill level on approval. | Pending, approved, rejected. | P0 |
| **Members list** | Manage members; **assign/change skill level**; see/lift bans; cancel on behalf. | Active, banned (until date), skill level per member. | P0 |
| **Club profile settings** | Name, logo, phone, socials, timezone, **MultiSport mode** (equal/priority). | Saved/error. | P0 |
| **Policies settings** | Booking-open, cancellation, no-show penalty, holiday behavior (standalone from wizard). | — | P1 |

### D. Admin console
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Clubs list** | All clubs; create; activate requested; suspend; **"Act as owner"** entry (starts owner impersonation). | Pending, active, suspended. | P0 |
| **Create/configure club** | Create + **optionally pre-fill the owner's setup**; assign an owner. | Draft, created, owner-assigned. | P0 |
| **Club requests** | Review owner-submitted requests. | Pending, approved, rejected. | P1 |
| **Holiday calendar** | **Auto-generate ~1 year** of Turkish national holidays; **review & approve**; add manual entries. | Pending (needs approval), approved, manual. | P0 |
| **Hidden pre-reservation** | Place a pre-reservation on a **future session before its slot opens**: pick slot + boat, **who it's for** (member / guest / admin), **payment type**. | Hidden until open; feedback that it materializes on open; **guaranteed** (regular) vs **may-be-displaced** (MultiSport in priority mode). | P0 |

---

## 6. Key user flows

1. **Member joins a club** — Club public page → Sign up (with KVKK consent) → verify email → Join
   (link/code) → *pending approval* → owner approves (sets skill level) → member can book. Handle the
   **waiting-for-approval** state gracefully.

2. **Member books at the rush** *(most critical)* — Slot list (countdown → opens) → **pick a boat** (if
   more than one) → choose payment type → **Book**. Outcomes to design distinctly: **Seated ✓**,
   **Waitlisted (position N)**, **Too late / full**, and **Ineligible** (skill or payment) shown *before*
   the tap wastes their time. Must feel fast and unambiguous on a phone.

3. **Waitlist auto-promotion** — someone cancels → next eligible person is **automatically booked** (no
   confirmation) and emailed. "My bookings" reflects it; consider a subtle in-app signal next visit.

4. **Member cancels** — My bookings / detail → Cancel, respecting the **cutoff** (disabled inside the
   window, with explanation). Confirm before cancelling.

5. **Owner setup** — Wizard (possibly pre-filled): **skill levels → boats → windows → boats-per-window →
   policies**. Forgiving and explanatory for non-technical owners.

6. **Owner runs a session** — Roster → after the session, **mark no-shows** → penalty applies. Show who
   got banned and until when. See **under-minimum** sessions and decide manually.

7. **Admin pre-reservation** — Pick a future (not-yet-open) slot + boat → set who-it's-for + payment type
   → saved **hidden**; appears when the slot opens. Communicate **guaranteed vs possibly-displaced**.

8. **Admin onboards a club** — Clubs list → Create club (optionally pre-fill setup) → assign owner → active.

9. **Member exercises KVKK rights** — Privacy & data → **export data** / **delete account** (confirmed).

---

## 7. Component state catalog (design each state)

- **Boat-seat card / row:** not-yet-open (countdown) · open with seats (N left) · full (waitlist) ·
  booked-by-me · waitlisted-by-me (position) · **ineligible — skill** ("Requires Intermediate") ·
  **ineligible — payment** ("MultiSport not allowed on this boat") · closed/past · cancelled.
- **Boat picker:** shown only when a slot has more than one boat; each option shows seats + eligibility.
- **Booking action button:** Book · Join waitlist · Cancel (enabled/disabled-by-cutoff) · loading ·
  success · error · **rate-limited** (too many rapid attempts).
- **Skill-level badge:** the member's level within a club; the owner's assign/change control.
- **Under-minimum indicator:** on a session in the owner's schedule/roster (advisory, not blocking).
- **Membership status:** pending · approved · rejected · banned (until date).
- **Club/slot/session lifecycle:** pending · active · suspended (club); scheduled · open · closed ·
  cancelled (slot/session).
- **Lists:** empty · loading · error · normal.
- **KVKK:** consent checkbox (with policy link) at sign-up; delete-account confirmation.

---

## 8. Content & tone

- Friendly, plain-language, encouraging. Members are athletes, not power users.
- Explain consequences before they happen (cancel cutoffs, no-show penalties, **why a boat is
  ineligible**).
- Errors are actionable, never blaming. All copy translatable (TR/EN) — no text baked into images.

## 9. i18n & theming requirements

- **Turkish default; English included.** Design with Turkish copy as the reference (it runs longer;
  avoid fixed-width labels and tight truncation).
- **Light and dark** (user preference) are both first-class — provide both for every mock.
- Language and theme are user-switchable.
- **Per-club brand skin (orthogonal to light/dark):** one **tokenized** design system, re-skinned per
  club via a **brand accent color** and an **optional heading font**. Design it as tokens (CSS
  variables) so a club's palette drops in without new components and works in **both** light and dark.
  A club that sets nothing gets a sensible default. This is *not* two structural designs — it's one
  system, many palettes.

## 10. Responsive priorities

- **Member experience is mobile-first.** Slot list, boat pick, and book/waitlist must be excellent on a
  phone. Desktop secondary but clean.
- **Owner console** used on both; the **setup wizard** and **roster** comfortable on desktop, usable on
  phone.
- **Admin console** desktop-first.

## 11. What we need from you (deliverables)

- Mockups for the **P0 screens** in **light and dark**, mobile + desktop where relevant.
- The **key flows** in §6 as connected screens.
- The **component states** in §7 (especially the boat-seat card, boat picker, and booking action).
- A component/pattern set consistent enough that engineering can map it to shadcn/ui primitives.

## 12. Out of scope for this design (v1 boundary)

Please **do not** design these now — they're planned for after v1: in-app payments, **memberships /
dues / session packages**, WhatsApp/SMS announcements, owner analytics dashboards, coach/instructor
roles, recurring bookings, and physical boat-inventory management. (Boat *types* and skill levels **are**
in v1 — see above; it's per-hull inventory that's deferred.) A **full structural alternate theme** (a
second design system like the "Calm & Premium" hero) is also post-v1 — v1 ships one tokenized system
re-skinned per club (§9).

Anything ambiguous, ask — the engineering spec has the underlying rules, and we can clarify behavior.

## 13. Chosen direction & next round (round-1 outcome)

- **Direction: 1a "Clean & Sporty"** is the base system, built as **design tokens** so per-club brand
  palettes (accent color + optional heading font) drop in and yield light+dark automatically.
- 1b "Calm & Premium" is **not** adopted as a separate system; its typographic restraint may inform the
  optional "premium" heading font and calmer screens (profile, club public page).
- **Next screens to extend in 1a:** join / approval (incl. waiting-for-approval), banned notice, and
  profile + privacy/KVKK (consent, data export, delete account). Plus: define the **token set** and show
  **2–3 example brand palettes** (light+dark), and the **TR→EN toggle** in-frame.
