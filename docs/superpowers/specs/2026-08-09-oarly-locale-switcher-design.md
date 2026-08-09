# Oarly TR/EN Locale Switcher — Design

**Date:** 2026-08-09
**Status:** Approved for implementation

## 1. Problem

The app is fully bilingual on the inside and monolingual on the outside. `messages/tr.json`
and `messages/en.json` are complete and parity-tested, `src/i18n/request.ts` negotiates a
locale on every request, `<html lang>` reflects it, and `setLocale` — a working Server
Action that writes the `locale` cookie — has existed since 2026-08-07.

**It has zero callers.** There is no control anywhere in the product that changes the
language. A visitor gets whatever `Accept-Language` negotiates and is stuck with it. The
English catalogue is, in practice, dead weight.

Three defects sit behind that missing button. Each would make a naively-added switcher
behave wrongly, so each is in scope:

1. **The cookie is host-only.** `setLocale` sets no `domain`, so a language chosen on
   `bebek.oarly.sbs` does not apply on `oarly.sbs` and vice versa. Every other cookie in
   the app is cross-subdomain (`advanced.crossSubDomainCookies` in `src/auth.ts`, driven
   by `env.COOKIE_DOMAIN`). A switcher on this cookie would make the language *flip* as
   the user moves between their club and the apex — the single most visible way a
   language switcher can be broken.

2. **The switch would not reach transactional email.** Emails render from `user.locale`
   (`src/lib/notify.ts`, `userLocale()` in `src/auth.ts`). That column is written at
   credential sign-up and by Google's OAuth profile mapping, and **nowhere else**. A user
   who switches the UI to English keeps receiving Turkish booking notices forever.

3. **`setLocale` does not validate its argument.** It is a public Server Action; the
   parameter is typed `Locale` but nothing enforces that at runtime. Today the damage is
   contained — `asLocale()` in `request.ts` narrows the cookie on read, so a junk value
   just falls through to negotiation — but §4.3 adds a database write, and an unvalidated
   value must not reach it.

## 2. Goals and non-goals

**Goals**

- A visible, one-click language control on every surface a user can reach.
- Switching applies everywhere at once: this page, cached routes, other subdomains, and
  future email.
- The control states which language is active without being opened.
- Coverage: nothing user-facing stays hardcoded in one language behind the switcher.

**Non-goals**

- **No locale-prefixed routing.** No `/tr/...` or `/en/...` segments, no `next-intl`
  routing middleware, no `Link` wrappers. URLs stay locale-free; the cookie is the
  carrier. Adding routing would touch every link in the product and change every
  canonical URL, for a two-locale app whose users do not share links across languages.
- **No third locale.** `locales` stays `['tr', 'en']`. The design does not forbid a
  third, but nothing is built speculatively for one (§4.5 notes the one place that
  would need revisiting).
- **No user-facing settings page.** There is no profile/preferences screen in the
  product; the switcher lives in the page chrome, next to the theme toggle.
- **No progressive enhancement without JavaScript.** The theme toggle, every form in the
  product, and sign-out already require JS. The switcher matches.

## 3. Approach: cookie is the source of truth

`request.ts` keeps its current precedence, unchanged:

```
requestLocale override  ??  `locale` cookie  ??  Accept-Language  ??  'tr'
```

**`user.locale` is deliberately NOT added to that chain**, and this is the one design
decision worth arguing. Reading it would mean a Better Auth session lookup inside
`getRequestConfig`, which runs on **every** page render, to serve one case: a returning
user on a device that has no cookie yet. That case is already served acceptably —
`Accept-Language` puts a Turkish speaker on Turkish and an English speaker on English,
which is what their saved preference almost always says. Paying a session query on every
render of every page, plus importing the whole `@/auth` module graph into the i18n
request config, is not worth closing that gap.

So the flow is one-directional and cheap:

| | reads | written by |
|---|---|---|
| **`locale` cookie** | every page render (UI language) | `setLocale` |
| **`user.locale`** | email rendering only | sign-up, Google profile, **and now `setLocale`** |

`setLocale` writes both. The UI reads the cookie; email reads the column; they agree
because one action sets both.

## 4. Components

### 4.1 `setLocale` (`src/i18n/set-locale.ts`) — hardened

Signature is unchanged: `setLocale(locale: Locale): Promise<void>`. Order of operations:

1. **Validate.** `if (!asLocale(locale)) return;` — reject anything not in `locales`
   before spending a rate-limit token or touching a cookie.

   `asLocale` already exists, but in `src/i18n/request.ts` — a module that pulls in
   `next-intl/server` and the dynamic message imports. It **moves to
   `src/i18n/config.ts`**, which owns `locales` and has no imports at all, and
   `request.ts` imports it from there. Its only other consumer is
   `src/i18n/request.test.ts`, whose import updates with it; the test itself is unchanged
   and keeps guarding the path-traversal case (`asLocale('../../etc/passwd')`), which is
   what stops a junk cookie reaching `import(\`../../messages/${locale}.json\`)`.
2. **Rate limit.** Unchanged: `localePerIp`, 60/min, silent return when limited. The
   existing comment explaining the silent refusal stays.
3. **Set the cookie**, now with three added attributes:
   - `domain: env.COOKIE_DOMAIN` when set, omitted when not. This is what makes the
     choice hold across `oarly.sbs` and `*.oarly.sbs`. `scripts/setup-dev-env.mjs` writes
     `COOKIE_DOMAIN=.<host>` for local dev, so the local subdomain setup gets it too.
   - `httpOnly: true`. Nothing client-side reads this cookie — the client learns the
     locale from `NextIntlClientProvider`, not from `document.cookie`.
   - `secure` derived from the app's own origin: `env.APP_URL.startsWith('https:')`. Not
     `NODE_ENV`, which would mark the cookie `Secure` on a plain-HTTP production-mode
     build and silently drop it.
   - `maxAge`, `path: '/'`, `sameSite: 'lax'` are unchanged.
4. **Persist to `user.locale`** when a session exists, so transactional email follows the
   UI. Signed-out visitors get the cookie only. A failure here must not fail the switch:
   the cookie is already set and the UI is about to change, so a database error is
   logged, not thrown.
5. **`revalidatePath('/', 'layout')`.**

**On step 5.** This is not decorative and `router.refresh()` is not an acceptable
substitute. `refresh()` re-renders only the *current* route; every other route already in
the client Router Cache keeps its old-language RSC payload, so navigating back to a page
visited before the switch shows the previous language until it expires. Revalidating the
root layout invalidates the whole client cache. Locale affects every string on every
route — the blast radius of the invalidation is exactly the blast radius of the change.

### 4.2 `LanguageToggle` (`src/components/language-toggle.tsx`)

**Form: a two-segment control, `TR | EN`, not a dropdown.** With exactly two locales a
menu is strictly worse — it costs a second click, and it hides which language is active
behind that click. The segmented control answers "what am I in?" and "what else is
there?" without being opened, and switches in one click. It is built on
`ui/toggle-group` + `ui/toggle`, added via `pnpm dlx shadcn@latest add toggle-group`
(both are shadcn-managed; see the hands-off rule for `src/components/ui`).

Rendered as `variant="outline" size="sm" spacing={0}` — the joined-pill segmented look,
roughly 60px wide, sitting beside the 36px ghost icon buttons already in the chrome.

**Base UI specifics that the implementation must respect** (verified against the
installed `@base-ui/react` in `node_modules/@base-ui/react/toggle-group/ToggleGroup.d.ts`
— this is *not* the Radix API):

- `value` is an **array**, not a string: `value={[current]}`.
- `onValueChange` receives `(groupValue: Value[], eventDetails)`.
- In single-select mode, clicking the **already-pressed** item unpresses it and yields
  `[]`. A language switcher has no "no language" state, so the handler must ignore an
  empty array and ignore a value equal to the current one.

**Interaction:**

- `useLocale()` (next-intl client hook) supplies the active locale; the root layout's
  `NextIntlClientProvider` already provides it.
- `useOptimistic` + `useTransition`: the pressed segment moves on click, before the
  server round trip. When the transition resolves, the provider's locale has updated and
  the optimistic value re-syncs to it.
- **Not `disabled` while pending.** Disabling a focused button drops keyboard focus. The
  handler ignores clicks while a switch is in flight; the control shows `aria-busy` and a
  reduced opacity instead.

**Accessibility:**

- The group carries `aria-label` from `common.language` ("Dil" / "Language").
- Each segment shows `TR` / `EN` but carries `aria-label` with the autonym — `Türkçe`,
  `English`. Autonyms are the convention for language pickers (you name a language in
  itself, so a speaker can find it in a UI they cannot read) and are identical in both
  catalogues, so they live as a constant in the component, not as message keys. Only the
  group label, which is genuinely prose, is translated.

### 4.3 `AppControls` (`src/components/app-controls.tsx`)

The cluster `LanguageToggle` + `ThemeToggle` (+ sign-out where the user is known) repeats
across eight surfaces. A single server component owns it, so ordering, spacing, and
future additions stay identical everywhere:

```tsx
<AppControls signOutUrl={…}>{/* optional leading slot */}</AppControls>
```

- `signOutUrl` optional — omitted on signed-out surfaces.
- `children` renders **before** the toggles, for the manage layout's account link.
- Order: language (text, widest) → theme (icon) → sign-out (icon).

### 4.4 Placement

Every surface a user can reach gets the control. The three that have no chrome at all
today get a minimal one.

| Surface | Today | Change |
|---|---|---|
| `app/page.tsx` (signed out) | theme | → `AppControls` |
| `app/page.tsx` (signed in) | theme + sign-out | → `AppControls signOutUrl` |
| `app/admin/layout.tsx` | theme + sign-out | → `AppControls signOutUrl` |
| `app/s/[slug]/manage/layout.tsx` | account link + theme + sign-out | → `AppControls signOutUrl` with the link as `children` |
| `src/components/member-header.tsx` | theme + sign-out | → `AppControls signOutUrl` |
| `app/(auth)/layout.tsx` | **nothing** | add a control row |
| `app/s/[slug]/join/page.tsx` (both branches) | **nothing** | add a control row |
| `app/privacy/page.tsx` | **nothing** | add a control row |
| `app/s/[slug]/page.tsx` | **nothing** | add a control row |
| `app/not-found.tsx` | **nothing** | add a control row |
| `app/request-club/page.tsx` (both branches) | **nothing** | add a control row |

The last three were omissions in the first draft of this table, caught in review. The club's
public landing page (`app/s/[slug]/page.tsx`) is reachable by anyone who has the subdomain
— it is the most public surface in the product — and `not-found.tsx` is where a mistyped URL
lands someone who may not read the language they are being apologised to in. Both were
chrome-less. The goal stated at the top of this section is "every surface a user can reach",
and these are surfaces a user can reach.

`app/(auth)/layout.tsx` matters most: it wraps sign-in, sign-up, forgot-password,
reset-password and verify-email. It is where a first-time visitor lands, in a language
they did not choose, with no account yet — the one place a switcher is not a convenience.

The join page matters for the same reason at club scale: an invite link is the one URL a
club shares with people who have never seen the product.

**Drive-by, in the same diff:** `app/request-club/page.tsx` returns a bare
`<div className="w-full">` and has no layout of its own, so it renders edge-to-edge
against the viewport with no padding or max-width. Every sibling page wraps its content.
It is wrapped like the others while the file is open.

### 4.5 Coverage: what the switcher reveals

A switcher is only worth what it switches. Two known gaps ship with it:

- **`src/components/theme-toggle.tsx`** hardcodes `aria-label="Toggle theme"` in English —
  in both the mounted and unmounted branches. Every screen-reader user on the Turkish UI
  hears an English label on a control that sits directly beside the new language picker.
  Moves to a message key.
- **`app/layout.tsx`** exports a static `metadata` whose `description` is Turkish prose
  (`"Kürek kulüpleri için seans ve rezervasyon yönetimi."`). It becomes an async
  `generateMetadata` reading from the catalogue, so the document description matches the
  page.

Implementation also sweeps for any other user-facing literal that escaped the catalogues.
Example-value placeholders (`"instagram"`, `"bebekrowing"`, `"boat."`) are illustrative
tokens, not prose, and stay as they are.

*(If a third locale is ever added, §4.2's segmented control is the one piece that does
not scale — three segments crowd a mobile header, and that is the point at which it
should become a dropdown.)*

## 5. New message keys

Added to both catalogues under `common`; `src/i18n/messages-parity.test.ts` enforces
parity structurally and needs no change.

| Key | tr | en |
|---|---|---|
| `common.language` | `Dil` | `Language` |
| `common.toggleTheme` | `Temayı değiştir` | `Toggle theme` |
| `common.appDescription` | `Kürek kulüpleri için seans ve rezervasyon yönetimi.` | `Session and booking management for rowing clubs.` |

## 6. Testing

**`setLocale` (integration, `src/i18n/set-locale.integration.test.ts`)**

- An invalid locale writes no cookie, writes no row, and consumes no rate-limit token.
- A valid locale sets the cookie with the expected `domain` / `httpOnly` / `secure` /
  `maxAge` / `sameSite`, asserted on the actual options object passed to `cookies().set`.
- With `COOKIE_DOMAIN` unset, `domain` is **absent** — not `undefined`-but-present, which
  some cookie serializers stringify.
- A signed-in user's `user.locale` row is updated. Asserted by **reading the row back**,
  not by asserting the mock was called: a state assertion is the only kind that survives
  a mutation moving the write outside its guard.
- A signed-out caller updates no row.
- A database failure still leaves the cookie set and does not throw.
- Rate-limited: no cookie, no row.

**`LanguageToggle` (jsdom, `src/components/language-toggle.test.tsx`)**

- Both segments render; the active locale's segment is pressed and the other is not.
- Clicking the inactive segment calls the action with that locale.
- Clicking the **active** segment (Base UI's unpress → `[]`) calls the action **not at
  all**. This is the case a naive port from the Radix API gets wrong.
- The group and both segments expose their accessible names.

**Placement (jsdom, `src/components/app-controls.test.tsx`)**

- Renders language and theme controls; renders sign-out only when `signOutUrl` is given;
  `children` render before the toggles.

Placement across the eight surfaces is verified by the reviewer against §4.4, not by
eight brittle render tests.

## 7. Risks

- **`revalidatePath('/', 'layout')` is a wide invalidation.** Accepted: locale changes
  every string on every route, so a narrower invalidation would be a correctness bug, not
  an optimisation. It fires only on an explicit user action, bounded at 60/min per IP.
- **The segmented control adds ~76px to header rows** that already truncate on narrow
  viewports. Where the truncating element sits *outside* the control cluster — the club
  name in `member-header.tsx`, which has `min-w-0 truncate` — its `truncate` absorbs the
  extra width and `shrink-0` on the cluster is exactly right.

  **`manage/layout.tsx` is the exception, and it is the one that bites.** Its truncating
  element is the owner's account link, which moves *inside* `AppControls` as the leading
  slot. A flex child only truncates when its parent is compressed, and `shrink-0`
  guarantees the cluster always gets its max-content width — so the link never shrinks
  below its `max-w-40` cap and the header overflows instead. Measured with an owner whose
  display name is absent and falls back to a 20-character email: 86px of overflow at
  320px, 31px at 375px, 16px at 390px, all of which fitted before. `flex-wrap` does not
  save it; the cluster drops to its own line and still cannot shrink.

  So the cluster's shrink behaviour must be split: the controls themselves never shrink,
  the leading slot does. To be checked at 320px on both layouts, since the fix has to hold
  for the surface that was already correct as well as the one that was not.
- **`httpOnly` is a one-way door for client-side reads.** Nothing reads the cookie from
  the client today, and next-intl's provider is the supported path if anything ever needs
  to.
