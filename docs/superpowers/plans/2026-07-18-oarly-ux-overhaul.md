# Oarly UX Overhaul — Flow Correctness + Visual Redesign

## Context

A post-deploy walkthrough of the live app (ica2.xyz / demo.ica2.xyz) surfaced two distinct problem classes across nearly every screen:

**Flow bugs that make working features look broken.** Sign-in succeeds but hard-redirects to the apex home, which never reads the session — so the page still shows "Sign in" and the login looks like it silently failed. The club home shows a "Join this club" button to everyone, including the club's own owner/admin. The join page has no guards (already-a-member just prints a status string; a logged-out submit silently no-ops). Sign-out hard-navigates to `/`, which on a subdomain is the club home = the Join CTA, with no confirmation. Native `<select>` dropdowns render white-on-white in dark mode. Switching Book ↔ My Reservations blanks the whole screen because there's no shared layout. Admin action buttons (suspend/activate/approve) are `void` server actions with no toast, no error boundary, no loading state.

**Thin, utilitarian visual design.** Apex home, club home, manage, and admin are bare centered columns / unstyled lists — no cards, off-brand chrome (admin has no `ThemeToggle`, no `text-brand`, no active-nav state). The booking cards bury the time range in tiny muted text, hide the payment method (Nakit vs MultiSport) inside a dropdown, show an unlabeled capacity number tile, and render seat pips as near-invisible outlines.

**Intended outcome:** one cohesive cycle that (a) fixes the flow/guard/feedback bugs so nothing *looks* broken, and (b) redesigns the key member/owner/admin/public screens on the existing token system, with a **date-strip + day-detail** booking view and a **confirmation dialog** on Book.

This plan was built from three parallel code explorations (apex auth/home, club/join/sign-out/guards, manage/admin/booking UI). File paths and root causes below are verified against the current code.

## Locked decisions (from user)

- **One cycle, one feature branch** (`feat/oarly-ux-overhaul`), merged locally --no-ff, **branch kept, not pushed**.
- **Booking view = date strip + day detail** (option A). Week/day selector on top, selected day's sessions below.
- **Book = confirmation dialog** — Book opens a dialog summarizing boat / time / **explicit Nakit vs MultiSport choice** → Confirm. Replaces instant one-tap booking and the hidden payment dropdown.
- **Account linking = verify first.** Investigate Better Auth's actual behavior for "email/pw account, then Google with same address" before choosing a policy; report, then decide.
- **Admin is in scope** (user added it).

## Standing constraints (project rules — apply to every task)

- No `Co-Authored-By` / AI-attribution trailer in any commit.
- **shadcn-first (standing rule, reinforced this cycle).** Wherever shadcn provides a primitive, use it instead of hand-rolling — the native-`<select>` dark-mode bug is the direct cost of not doing this. Never hand-author or edit `src/components/ui/*`; add via CLI only (`pnpm dlx shadcn@latest add <name>`), registry `@shadcn`, style `base-nova` (Base UI, NOT Radix — confirmed in `components.json`). Custom composed components in `src/components/` are fine but must be built **on** shadcn primitives, not around raw HTML equivalents. Do NOT bulk-install the registry — add only the set below, as each task reaches it. Exact set finalized against the registry at execution; expected: `select`, `dialog`, `badge`, `skeleton`, `spinner`, `tabs` (or `navigation-menu`), `avatar`, `tooltip`.
- Server-side zod validation stays authoritative; `club.id`/identity always from the guard, never client input.
- Multi-tenant nav: client `<Link>` uses public paths (`/book`, `/join`, `/manage/...`); server actions `revalidatePath('/s/${slug}/...')`.
- Preserve real secrets in `.env.local`; never echo them.
- Skeletons must match real layout dimensions (minimize layout shift) — carry over the prior member-UX lesson.

## Execution model

After approval: commit this as a spec/plan under `docs/superpowers/plans/2026-07-18-oarly-ux-overhaul.md` (per project convention), then execute via **subagent-driven-development** on `feat/oarly-ux-overhaul` — fresh implementer per task, per-task spec+quality review, opus whole-branch review at the end, then finish via finishing-a-development-branch (merge locally, keep branch). Commits grouped by workstream for reviewability. **Phase 0 (design prototype) gates a user sign-off before any wiring.**

---

## Phase 0 — Design prototype & sign-off

**Task 0.1 — Interactive prototype artifact.** Build one self-contained HTML artifact (published) mocking the three redesigned screens against real Oarly content and the existing tokens (teal `#0E9E93`/`#2DD4BF`, Nakit/MultiSport, semantic tones): (a) member booking = date-strip + day-detail + the Book confirmation dialog; (b) apex home (logged-out + logged-in states); (c) club home (anon / non-member / member / owner states). Theme-aware light+dark. **Gate:** user reviews and approves the visual direction before Phase 3/4 implementation begins. Bug-fix workstreams (Phase 1–2) can proceed in parallel since they don't depend on final visuals.

---

## Phase 1 — Auth & navigation flow correctness

Files: `app/page.tsx`, `app/(auth)/sign-in/*`, `app/(auth)/sign-up/*`, `app/(auth)/layout.tsx`, `src/auth.ts`, `src/lib/session.ts`, `src/lib/membership.ts`, `app/s/[slug]/page.tsx`, `app/s/[slug]/join/{page,actions}.tsx`, `src/components/sign-out-button.tsx`.

**1.1 Apex home reflects auth state.** `app/page.tsx` currently never reads the session and shows "Sign in" unconditionally. Make it a session-aware server component: logged-out → landing (Phase 4); logged-in → show identity + primary CTA (e.g. "My clubs" / continue) + sign-out, not a bare "Sign in". Reuse `getCurrentUser()` (`src/lib/session.ts:14`).

**1.2 Post-login destination.** Sign-in defaults `redirectTo` to `/` (`app/(auth)/sign-in/page.tsx:15`). Keep the safe-redirect behavior, but ensure the no-`redirect` case lands somewhere that reflects logged-in state (the reworked apex home from 1.1, or a "my clubs" view). No behavior change to the validated deep-link path (`safeRedirect`, `src/lib/urls.ts`).

**1.3 "Already authenticated" guard on auth pages.** `app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx` have no guard. Add a server-side check: if `getCurrentUser()` is set, `redirect()` away (to the validated `dest`, default the apex home). Prevents a logged-in user from sitting on the sign-in form.

**1.4 Sign-in feedback polish.** `sign-in-form.tsx` disables the submit button on `pending` but shows no spinner, and the Google button (`:52-58`) has no pending/error handling. Add a pending indicator to both; wrap the Google call so failures surface a toast.

**1.5 Account-linking spike (verify-first).** No `accountLinking`/`trustedProviders` configured (`src/auth.ts` — defaults govern). Verify the real behavior for email/pw-then-Google-same-address against the installed Better Auth version (Context7 docs + a local reproduction against dev PG). Produce a short report of what actually happens. **Decision point:** recommend explicit config (likely auto-link on verified email) — confirm with user, then apply the chosen `account.accountLinking` config in `src/auth.ts`. This task's deliverable is the report + the agreed config, not a guess.

**1.6 Sign-out → sign-in + success toast.** `SignOutButton` (`src/components/sign-out-button.tsx:13`) hard-navigates to `/`. Redirect to the apex sign-in instead, and surface a "Signed out" success toast on arrival (e.g. via a `?signedout=1` param the sign-in page reads once, or a toast-on-mount). Keep the shared button usable from both member header and admin layout.

**1.7 Club home membership-aware CTA.** `app/s/[slug]/page.tsx` does no session/membership check and shows Join to all. Load `getCurrentUser()` + `getMembership(db, userId, club.id)` and branch the CTA: anon → "Sign in to join"; non-member → "Request to join"; pending → "Request pending"; approved member → "Go to booking" (`/book`); owner → "Manage club" (`/manage`); banned → banned notice. Reuse `getMembership` (`src/lib/membership.ts:20`).

**1.8 Join page + action guards.** `app/s/[slug]/join/page.tsx`: early-redirect approved members away (to `/book`), keep the request form only for non-members / re-surface pending/rejected/banned status clearly. `joinAction` (`join/actions.ts`) currently `return`s silently when logged out and ignores `requestToJoin`'s result — instead redirect logged-out submits to sign-in (`?redirect=` back to `/join`), and surface the `'created' | 'exists' | 'club_inactive'` outcome (`src/lib/join.ts:6`) as a toast/message.

**1.9 COOKIE_DOMAIN ops note.** Cross-subdomain sessions require `COOKIE_DOMAIN=.ica2.xyz` set on Vercel (`src/auth.ts:73`, `src/env.ts:11`); code is ready, env is not. Cannot be set from here — document in the plan's ops checklist + flag to user for the Vercel dashboard.

---

## Phase 2 — shadcn adoption, component & contrast fixes

**2.0 shadcn component adoption (foundation).** Add the needed primitives via CLI (`select`, `dialog`, `badge`, `skeleton`, `spinner`, nav primitive, `avatar`, `tooltip` — final set confirmed against `@shadcn` at execution). Then replace hand-rolled equivalents app-wide for consistency: rebase the custom `StatusPill` (`src/components/booking-status-badge.tsx`) on shadcn `Badge` (keep the tone variants); rebuild `PageSkeleton` (`src/components/page-skeleton.tsx`) on shadcn `Skeleton`; use `Avatar` for club logo tiles (`member-header.tsx`, club home); use `Spinner` for pending states. Each replacement is behavior-preserving; verify visually. This task front-loads the primitives the later phases consume.

**2.1 Replace native `<select>` with shadcn Select.** Root cause of white-on-white: native `<select>` with `bg-transparent` and no `<option>` colors inherits near-white `--foreground` on the OS light menu in dark mode. Using shadcn `Select` (from 2.0) renders a themed popup (`bg-popover text-popover-foreground`, tokens already defined both themes). Replace `app/s/[slug]/manage/members/skill-level-select.tsx:35-47` (skill-level assignment); the booking payment select (`book-calendar.tsx:17,76`) is superseded by the Phase-3 confirmation dialog, so this task mainly lands on the members dropdown. Audit the repo for any other native `<select>` and convert.

**2.2 Seat-pip contrast.** Unfilled pips are bare `border-border` (`book-calendar.tsx:51`) — `--border` is `oklch(1 0 0 / 10%)` in dark = invisible. Give unfilled pips a real filled track (e.g. `bg-muted` with a slightly stronger border) and keep filled = `muted-foreground`, own-seat = `brand`. Re-tune as part of the Phase-3 card redesign so pips read in both themes.

**2.3 Shared member layout (no full-page reload on tab switch).** `/book` and `/bookings` are sibling segments with no shared layout; `MemberHeader` is rendered inside each page and each has a `loading.tsx` → full-screen `PageSkeleton`, so switching tabs blanks the header + nav too. Introduce a route-group layout `app/s/[slug]/(member)/layout.tsx` that renders `MemberHeader` once, move `book/` and `bookings/` under it, and scope `loading.tsx` to the group's children so only the content region swaps while the nav persists. Update `PageSkeleton` (now on shadcn `Skeleton`) to skeleton only the content. Consider unifying the member/manage/admin tab nav on the shadcn nav primitive (`tabs`/`navigation-menu`) for consistency.

---

## Phase 3 — Booking redesign (date strip + confirmation dialog)

Files: `app/s/[slug]/book/book-calendar.tsx` (rewrite), `app/s/[slug]/book/{actions,page}.tsx`, new `date-strip` component, shadcn `dialog` (CLI). Reuse the existing data model unchanged: `computeMemberCalendar` / `MemberVirtualSession` (seatsLeft, bookingOpen, eligibility, paymentChoices, defaultPayment, myStatus, myQueuePosition, bookingOpensAt) and `bookSeatAction` (`app/s/[slug]/book/actions.ts`).

**3.1 Date-strip day selector.** Horizontal week strip of the ~14-day window; each day shows date + a marker when it has sessions; selected day highlighted; closed/holiday days marked. Client-side day selection (no route change). Keep it usable on mobile (scrollable) and desktop.

**3.2 Day-detail session cards.** For the selected day, render sessions with the redesigned card: **time range as the headline** (large, high-contrast — replaces `text-xs text-muted-foreground`), boat name + labeled capacity (e.g. "4 seats", not a bare number tile), contrast-fixed seat pips (2.2), and an explicit payment chip (Nakit / MultiSport / "Nakit or MultiSport") instead of a hidden dropdown. Preserve all existing UI states (open/full/booked/waitlisted/ineligible/notopen/closed) and their tone mapping from the current `StatusPill`.

**3.3 Book confirmation dialog.** Using shadcn `Dialog` (from 2.0), Book opens a dialog summarizing boat, day, time range, and the payment choice; when `paymentChoices.length > 1` the dialog holds the Nakit/MultiSport selection (default = `defaultPayment`); Confirm submits. For full sessions the dialog is the "Join waitlist" confirm. Wire the confirmed submit to the existing `bookSeatAction` (hidden fields windowId/boatTypeId/startAt/idempotencyKey/paymentType), keep the success toast (seated vs waitlisted) and the per-mount idempotency key. Server contract unchanged.

**3.4 Verify against the prototype** approved in Phase 0.

---

## Phase 4 — Visual design polish (apex home, club home, manage, admin)

Applies the approved prototype direction; all on existing tokens + shadcn Card/Button/badges.

**4.1 Apex home landing.** Replace the single-button page (`app/page.tsx`) with a real landing for logged-out visitors (what Oarly is, sign-in / sign-up CTAs, theme toggle) + the logged-in state from 1.1.

**4.2 Club home design.** Redesign `app/s/[slug]/page.tsx` around the membership-aware CTA from 1.7 — club identity (logo/name/tagline/description) with proper hierarchy and the correct single CTA per state.

**4.3 Manage chrome.** `app/s/[slug]/manage/layout.tsx` + `_nav.tsx` + landing (`manage/page.tsx`): give the section real surface (cards), keep the active-tab nav, make the setup checklist read as a styled list rather than raw glyphs. Follow the member-header active-tab pattern.

**4.4 Admin console.** `app/admin/*`:
- **Chrome** (`layout.tsx`): add `ThemeToggle`, `text-brand` wordmark, active-nav state (member-header pattern), drop the duplicate `/admin` nav link.
- **List UI** (`page.tsx`, `requests/page.tsx`): shadcn `Card` rows, real `Button`s (danger styling for Suspend), status **badges** (the `Badge`-based `StatusPill` from 2.0) instead of "· active" text and muted text-links.
- **Action feedback:** convert `setClubStatusAction` (`app/admin/actions.ts:8`, `void`) to return a typed result and surface success/error via toast (client wrapper), matching the app's sonner usage. Add a success toast to the create-club flow (`clubs/new/actions.ts`).
- **Boundaries:** add `app/admin/loading.tsx` + `app/admin/error.tsx` (layout-faithful skeleton, reuse `route-error`).
- Out of scope this cycle (note only): a dedicated reject/decline flow for pending clubs, audit-log viewer, users page.

---

## i18n

Every new user-facing string added in EN (`messages/en.json`) and TR (`messages/tr.json`), mirrored. New namespaces/keys for: auth feedback (signed-out toast, google error), club-home CTA states, join outcomes, booking (payment chip labels, confirm-dialog copy, capacity label), admin (action toasts, status badges). TR default.

## Verification

- `pnpm lint` (eslint --max-warnings 0) → 0.
- `pnpm test` unit + `pnpm test:integration` → green (booking/eligibility/seating integration suites must stay green; no server-contract changes).
- `pnpm build` → clean, all routes compile.
- **End-to-end manual smoke on dev subdomains** (lvh.me / *.localhost) — the flow bugs are only observable in a running app, so drive them, don't just typecheck:
  1. Sign in → land on a logged-in-looking page (not the "Sign in" splash). Visit `/sign-in` while logged in → redirected away.
  2. Google sign-in path (with GOOGLE_* set) → same; run the account-linking repro from 1.5.
  3. Club home as owner → "Manage club" (no Join); as non-member → "Request to join"; as member → "Go to booking".
  4. Join page as approved member → redirected to `/book`; logged-out submit → sent to sign-in.
  5. Sign out → lands on apex sign-in with a "Signed out" toast.
  6. Members skill-level dropdown → readable in dark mode.
  7. Book ↔ My Reservations → nav/header persists, only content swaps (no full blank).
  8. Booking → date strip selects days; Book opens confirmation dialog with Nakit/MultiSport choice; confirm → seated/waitlisted toast; verify seat pips visible in both themes.
  9. Admin → suspend/activate/approve show toasts; create-club shows success; loading/error boundaries render.
- Prototype (Phase 0) approved by user before Phase 3/4 wiring.

## Follow-ups / not in this cycle

Notifications (silent waitlist promotion), attendance/penalties, admin reject flow + audit viewer + holiday calendar + pre-reservation, KVKK, impersonation. Ops: set `COOKIE_DOMAIN=.ica2.xyz` on Vercel; push `main` (ahead of origin).
