# Oarly — Designer Brief

**For:** the visual/UX designer producing mockups
**From:** product + engineering
**Date:** 2026-07-15

This brief describes **what each screen must do, the flows they connect, and the states they must
handle** — so you can design the interface. It deliberately makes **no visual styling decisions**
(color, type, spacing, imagery, brand): those are yours. Where behavior constrains layout, it's noted.

The engineering spec (data model, rules) lives at
`docs/superpowers/specs/2026-07-15-oarly-design.md` — read it if you want the full logic, but this
brief is self-contained.

---

## 1. What Oarly is

A multi-club web app that lets rowing clubs manage session appointments. Members book sessions;
owners run their club; a platform admin oversees everything. **No payments in the app** — members pay
in person at the club.

## 2. Who uses it, and how

- **Members** — book and manage sessions, mostly **on a phone**, often **in a rush** the moment
  booking opens (20–25 people competing for a handful of seats within seconds). Speed and clarity of
  "am I in, waitlisted, or too late?" matter more than anything.
- **Owners** — often **non-technical or older**; run one club. Their tools must be forgiving, guided,
  and hard to misconfigure. Used on desktop and phone.
- **Admin** — the platform operator (technical). Efficiency over hand-holding.

## 3. Design principles (behavioral, not visual)

- **Mobile-first for members.** The booking moment happens on a phone. Optimize the session list and
  the book/waitlist action for one-handed, fast use.
- **Guided for owners.** The setup is multi-step and consequential; prefer wizards, sensible defaults,
  inline explanation, and confirmation on destructive actions.
- **State legibility.** A session's status (open, full, waitlisted, booked, banned-from-booking,
  closed) must be unmistakable at a glance.
- **Two themes, two languages.** Every screen must work in **light and dark**, and in **Turkish
  (default) and English**. Turkish strings run longer than English — leave room; don't design to
  fixed-width labels.
- **Accessible.** Sufficient contrast in both themes, keyboard operable, clear focus, touch targets
  comfortable on mobile.

---

## 4. Global patterns (design once, reused everywhere)

- **Top-level navigation** for each role (member / owner / admin), adapted to mobile (bottom bar or
  drawer) and desktop.
- **Club switcher** — a member can belong to **multiple clubs**; they need a fast way to switch the
  active club. Owners with one club don't need it; design for both.
- **Language switcher** and **theme toggle** — reachable from account/settings, and ideally from the
  public/auth screens too.
- **Empty / loading / error states** for every list and data view.
- **Confirmation & toast/feedback** pattern for actions (booked, cancelled, promoted, saved).
- **Role-aware chrome** — the same person may be a member of one club and owner of another; the UI
  should make the current context obvious.

---

## 5. Screen inventory

Priority: **P0** = required for a usable MVP, **P1** = important, **P2** = nice-to-have.

### A. Public & Auth
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Platform landing** (`oarly.sbs`) | Explain Oarly; entry to sign in / sign up. | Logged-out vs logged-in. | P1 |
| **Club public page** (`{slug}.oarly.sbs`) | A club's front door: name, logo, phone, socials; "Join this club" CTA. | Not-a-member (Join CTA), pending approval, already a member (enter app). | P0 |
| **Sign up** | Create account. | Required: first name, last name, phone, email, password. Optional: birthday, gender, socials. Default payment preference (regular/MultiSport). Field-level validation. | P0 |
| **Sign in** | Email/password + **Google**. | Error, loading. | P0 |
| **Forgot password / reset** | Request + set new password. | Sent, invalid/expired token, success. | P0 |
| **Change password** | From account settings. | — | P1 |
| **Join a club** | Via club link or a **club code** entry. | Submitting, pending owner approval, approved, rejected. | P0 |

### B. Member app
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Session list / calendar** | Browse a club's upcoming sessions and book. | Per-session: not-yet-open, open-with-seats, full (join waitlist), already booked, waitlisted, closed/past, banned (can't book). Day/week grouping. **This is the highest-traffic, most time-critical screen.** | P0 |
| **Session detail** | Confirm booking; choose **payment type** for this booking (default pre-selected, changeable). | Seats remaining, waitlist length/position, booking-open countdown, cutoff for cancellation, book / join-waitlist / cancel actions. | P0 |
| **My bookings** | Upcoming and past bookings across the active club. | Booked, waitlisted (with position), attended, no-show, cancelled. Cancel action honors cutoff. | P0 |
| **Profile & preferences** | Edit profile, default payment type, socials, language, theme. | Saved/error. | P0 |
| **My clubs** | List memberships, switch active club, join another. | Approved, pending, banned (with ban-until). | P0 |
| **Banned notice** | When a member is under a no-show penalty. | Show reason + when the ban lifts; block booking. | P1 |

### C. Owner console
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Setup wizard** | First-run configuration (may arrive **pre-filled by admin**). Steps: working days & **time windows** (multiple per day) → **session length** (default + per-window) & **capacity** → **booking-open** (always / N days-weeks) → **cancellation** (on/off + cutoff) → **no-show penalty** (off/2d/1w/2w/1m/never) → **holidays** (open on holidays? overrides) → **public profile** (logo, phone, socials). | Draft/incomplete, pre-filled, saved. Each step editable later. | P0 |
| **Schedule manager** | See generated sessions; **override** individual session length/boundaries/capacity; **open/close/cancel** a session manually. | Generated vs overridden, open/closed/cancelled, holiday-affected. | P0 |
| **Session roster** | View a session's booked + waitlisted people; after the session **mark attendance / no-show**. | Seated list, waitlist (ordered), attendance marking, penalty auto-applied feedback. | P0 |
| **Join requests** | Approve/reject members. | Pending, approved, rejected. | P0 |
| **Members list** | Manage current members; see/lift bans; cancel on behalf. | Active, banned (with until date). | P1 |
| **Club profile settings** | Edit name, logo, phone, socials, timezone, MultiSport mode (equal/priority). | Saved/error. | P0 |
| **Policies settings** | Edit booking-open, cancellation, no-show penalty, holiday behavior (same fields as wizard, standalone). | — | P1 |

### D. Admin console
| Screen | Purpose | Key states / notes | Priority |
|--------|---------|--------------------|----------|
| **Clubs list** | All clubs; create a club; activate requested clubs; suspend. | Pending, active, suspended. | P0 |
| **Create/configure club** | Create a club and **optionally pre-fill the owner's setup wizard**; assign an owner. | Draft, created, owner-assigned. | P0 |
| **Club requests** | Review owner-submitted club requests. | Pending, approved, rejected. | P1 |
| **Holiday calendar** | **Auto-generate ~1 year** of Turkish national holidays, **review & approve**, add manual entries. | Pending (needs approval), approved, manual. | P0 |
| **Hidden pre-reservation** | Place a pre-reservation on a **future session before it opens**: pick session, **who it's for** (a member / free-text guest / admin), **payment type**. | Hidden until session opens; feedback that it will materialize on open; guaranteed vs may-be-displaced (MultiSport in priority mode). | P0 |

---

## 6. Key user flows

Design these end-to-end; each names the screens it touches.

1. **Member joins a club** — Club public page → Sign up / Sign in → Join (link/code) → *pending
   approval* → owner approves → member can book. Handle the **waiting-for-approval** state gracefully.

2. **Member books at the rush** *(most critical)* — Session list (booking-open countdown → opens) →
   Session detail → choose payment type → **Book**. Outcomes to design distinctly: **Seated ✓**,
   **Waitlisted (position N)**, **Too late / full**. Must feel fast and unambiguous on a phone.

3. **Waitlist auto-promotion** — someone cancels → the next person is **automatically booked** (no
   confirmation) and emailed. In-app, "My bookings" should reflect the change; consider a subtle
   in-app signal on next visit. (No modal to accept — it's automatic.)

4. **Member cancels** — My bookings / Session detail → Cancel. Respect the **cutoff**: if inside the
   window, disable with an explanation. Confirm before cancelling.

5. **Owner setup** — Setup wizard (possibly pre-filled) → save → schedule generates → Schedule
   manager. Design the wizard to be **forgiving and explanatory** for non-technical owners.

6. **Owner runs a session** — Session roster → after the session, **mark no-shows** → penalty applies
   automatically. Show which members got banned and until when.

7. **Admin pre-reservation** — Admin picks a future (not-yet-open) session → sets who-it's-for +
   payment type → saved **hidden**. When the session opens it appears as a booking. Communicate the
   **guaranteed vs. possibly-displaced** distinction in the UI.

8. **Admin onboards a club** — Clubs list → Create club (optionally pre-fill setup) → assign owner →
   club active.

---

## 7. Component state catalog (design each state)

- **Session card / row:** not-yet-open (with countdown) · open with seats (N left) · full (join
  waitlist) · booked-by-me · waitlisted-by-me (position) · closed/past · cancelled · unavailable
  because banned.
- **Booking action button:** Book · Join waitlist · Cancel (enabled/disabled-by-cutoff) · loading ·
  success · error.
- **Membership status:** pending approval · approved · rejected · banned (until date).
- **Club/session lifecycle:** pending · active · suspended (club); scheduled · open · closed ·
  cancelled (session).
- **Lists:** empty · loading · error · normal.
- **Payment type selector:** regular vs MultiSport, with the club's mode affecting availability
  (in priority mode, communicate that MultiSport may not get a seat if regulars fill up).

---

## 8. Content & tone

- Friendly, plain-language, encouraging. Members are athletes, not power users.
- Explain consequences before they happen (e.g. "You can't cancel within 8 hours of the session",
  "No-shows may be penalized").
- Errors are actionable, never blaming.
- All copy must be translatable (TR/EN) — no text baked into images.

## 9. i18n & theming requirements

- **Turkish is the default; English is included.** Design with Turkish copy as the primary reference —
  it runs longer; avoid fixed-width labels and tight truncation.
- **Light and dark** must both be first-class. Provide both for every screen you mock.
- Language and theme are user-switchable; show the controls somewhere sensible.

## 10. Responsive priorities

- **Member experience is mobile-first.** The session list, session detail, and book/waitlist action
  must be excellent on a phone. Desktop is secondary but should be clean.
- **Owner console** is used on both; the **setup wizard** and **roster** should be comfortable on
  desktop and usable on phone.
- **Admin console** is desktop-first.

## 11. What we need from you (deliverables)

- Mockups for the **P0 screens** in **light and dark**, mobile + desktop where relevant.
- The **7 key flows** in §6 as connected screens.
- The **component states** in §7 (especially the session card and booking action).
- A component/pattern set consistent enough that engineering can map it to shadcn/ui primitives.

Anything ambiguous, ask — the engineering spec has the underlying rules, and we can clarify behavior.
