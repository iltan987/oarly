# TR/EN Locale Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a visible TR/EN language control on every user-reachable surface, backed by a `setLocale` action that applies the choice across subdomains, across cached routes, and to transactional email.

**Architecture:** The `locale` cookie stays the single source of truth for the UI; `setLocale` writes it *and* mirrors it into `user.locale` (which only email reads). A `LanguageToggle` client component drives the action optimistically; an `AppControls` server component owns the language/theme/sign-out cluster so all eight chrome surfaces stay identical.

**Tech Stack:** Next.js 16.3.0 (App Router, `proxy.ts`), next-intl 4.13.5 (no i18n routing), Base UI + shadcn `base-nova` style, Drizzle + Postgres, Better Auth, Vitest (node + jsdom).

**Spec:** `docs/superpowers/specs/2026-08-09-oarly-locale-switcher-design.md`

## Global Constraints

- **Never hand-author or edit `src/components/ui/*`.** Those files are shadcn-CLI-managed. Add primitives with `pnpm dlx shadcn@latest add <name>` and commit the CLI's output unmodified. Custom components go in `src/components/`.
- **Never add `Co-Authored-By` or any AI-attribution trailer to a commit message.**
- `locales` stays `['tr', 'en'] as const`; `defaultLocale` stays `'tr'`.
- **No locale-prefixed routing.** No `/tr/…` or `/en/…` segments, no next-intl routing middleware, no `Link` wrappers.
- A `'use server'` module may only export async Server Actions. Any helper that takes a non-serializable argument (a Drizzle `db` handle) **must** live in a different file.
- Every new user-facing string goes in **both** `messages/tr.json` and `messages/en.json`. `src/i18n/messages-parity.test.ts` enforces structural parity and must keep passing.
- Run `pnpm lint` (zero warnings) and `pnpm test` before every commit. Integration tests run via `pnpm test:integration`.
- The test database is `postgresql://postgres:postgres@localhost:5433/oarly_test`. Never point anything at port 5434 (dev) or a remote host. Never drop `oarly_test`.
- Do not run `pnpm db:migrate` against anything but localhost. This plan adds **no** migrations.

---

### Task 1: Harden `setLocale`

**Files:**
- Modify: `src/i18n/config.ts`
- Modify: `src/i18n/request.ts`
- Modify: `src/i18n/request.test.ts:3`
- Create: `src/lib/user-locale.ts`
- Create: `src/lib/user-locale.integration.test.ts`
- Modify: `src/i18n/set-locale.ts`
- Create: `src/i18n/set-locale.test.ts`
- Modify: `src/lib/rate-limit-wiring.test.ts`

**Interfaces:**
- Consumes: `RATE_LIMITS.localePerIp`, `enforceRateLimit`, `getClientIp`, `getCurrentUser` — all already exist.
- Produces:
  - `asLocale(value: string | undefined | null): Locale | undefined` — now exported from `@/i18n/config`.
  - `setUserLocale(db: Db, userId: string, locale: Locale): Promise<void>` in `@/lib/user-locale`.
  - `setLocale(locale: Locale): Promise<void>` — unchanged signature, hardened behaviour.

---

- [ ] **Step 1: Move `asLocale` into `config.ts`**

`src/i18n/config.ts` becomes:

```ts
export const locales = ['tr', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'tr';
export const LOCALE_COOKIE = 'locale';

/**
 * Narrow an arbitrary string to a supported Locale, or undefined.
 *
 * Lives here, next to `locales`, rather than in `request.ts`: `set-locale.ts` needs it
 * to validate a Server Action argument, and importing the next-intl request config —
 * with its `next-intl/server` dependency and its dynamic `messages/*.json` import — into
 * an action just to reach a three-line type guard is the wrong direction of dependency.
 */
export function asLocale(value: string | undefined | null): Locale | undefined {
  return value && (locales as readonly string[]).includes(value) ? (value as Locale) : undefined;
}
```

In `src/i18n/request.ts`, delete the local `asLocale` definition and import it instead:

```ts
import { asLocale, type Locale, LOCALE_COOKIE } from './config';
```

Note `Locale` and `locales` may no longer both be needed in `request.ts` — let `pnpm lint` (which runs `unused-imports`) tell you; do not guess.

In `src/i18n/request.test.ts:3`, change the import to `import { asLocale } from '@/i18n/config';`. **Change nothing else in that test** — its `asLocale('../../etc/passwd')` case is what proves a tampered cookie cannot reach the dynamic `messages/${locale}.json` import.

- [ ] **Step 2: Run the moved test**

```bash
pnpm test src/i18n/request.test.ts
```
Expected: PASS (5 assertions across 2 tests). If it fails to resolve `@/i18n/config`, the import path is wrong — fix before continuing.

- [ ] **Step 3: Write the failing integration test for `setUserLocale`**

Create `src/lib/user-locale.integration.test.ts`:

```ts
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/db/schema';

import { setUserLocale } from './user-locale';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('setUserLocale', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
  });
  afterAll(async () => { await pool.end(); });

  // randomUUID, never a clock-derived id: `Date.now()` and `performance.now()` are both
  // millisecond-resolution, so ids minted in a tight loop collide and the insert fails
  // with `duplicate key value violates user_pkey` on any machine fast enough. That is a
  // defect this repo has already shipped to CI once.
  async function mkUser(locale: 'tr' | 'en') {
    const id = `ul-${randomUUID()}`;
    await db.insert(schema.user).values({ id, name: 'X', email: `${id}@t.co`, locale });
    return id;
  }

  async function readLocale(id: string) {
    const [row] = await db.select({ locale: schema.user.locale })
      .from(schema.user).where(eq(schema.user.id, id));
    return row?.locale;
  }

  it('overwrites the stored locale', async () => {
    const id = await mkUser('tr');
    await setUserLocale(db, id, 'en');
    expect(await readLocale(id)).toBe('en');
  });

  it('is idempotent', async () => {
    const id = await mkUser('en');
    await setUserLocale(db, id, 'en');
    await setUserLocale(db, id, 'en');
    expect(await readLocale(id)).toBe('en');
  });

  it('touches only the addressed user', async () => {
    // A missing WHERE clause updates every row and every test above still passes.
    const target = await mkUser('tr');
    const bystander = await mkUser('tr');
    await setUserLocale(db, target, 'en');
    expect(await readLocale(target)).toBe('en');
    expect(await readLocale(bystander)).toBe('tr');
  });

  it('is a no-op for an unknown user id', async () => {
    await expect(setUserLocale(db, `ul-${randomUUID()}`, 'en')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
pnpm test:integration src/lib/user-locale.integration.test.ts
```
Expected: FAIL — cannot resolve `./user-locale`. If you instead see `0 tests`, the suite crashed at module load or `TEST_DATABASE_URL` is unset and `describe.skipIf` silently skipped everything; both look like success in a summary line. Confirm the run reports 4 tests before moving on.

- [ ] **Step 5: Implement `setUserLocale`**

Create `src/lib/user-locale.ts`:

```ts
import { eq } from 'drizzle-orm';

import type { DbOrTx } from '@/db';
import { user } from '@/db/schema';
import type { Locale } from '@/i18n/config';

/**
 * Mirror the UI language choice onto the user row.
 *
 * `user.locale` is read by exactly one consumer — transactional email
 * (`src/lib/notify.ts`, `userLocale()` in `src/auth.ts`) — and until now was written
 * only at credential sign-up and by Google's OAuth profile mapping. Without this, a user
 * who switches the UI to English keeps receiving Turkish booking notices forever.
 *
 * Deliberately NOT in `set-locale.ts`: that file is `'use server'`, so every export
 * becomes a Server Action and a `Db` parameter would be an unserializable argument.
 */
export async function setUserLocale(db: DbOrTx, userId: string, locale: Locale): Promise<void> {
  await db.update(user).set({ locale }).where(eq(user.id, userId));
}
```

`DbOrTx` is the codebase's existing handle type (`src/db/index.ts`) — it accepts both the pooled `db` and a transaction handle, which is the convention every other helper in `src/lib/` follows.

- [ ] **Step 6: Run the integration test to verify it passes**

```bash
pnpm test:integration src/lib/user-locale.integration.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 7: Write the failing unit test for `setLocale`**

Create `src/i18n/set-locale.test.ts`. This is a node-environment test; it mocks the boundaries and asserts the cookie options object exactly.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
const getCurrentUser = vi.fn();
const setUserLocaleMock = vi.fn();
const revalidatePath = vi.fn();
const enforceRateLimit =
  vi.fn(async (): Promise<{ limited: boolean; retryAfterSec?: number }> => ({ limited: false }));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/session', () => ({ getCurrentUser: () => getCurrentUser() }));
vi.mock('@/lib/user-locale', () => ({
  setUserLocale: (...a: unknown[]) => setUserLocaleMock(...a),
}));
vi.mock('@/lib/rate-limit-guard', () => ({
  enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a),
}));
vi.mock('@/lib/request-ip', () => ({ getClientIp: async () => '203.0.113.7' }));

import { setLocale } from './set-locale';

beforeEach(() => {
  vi.clearAllMocks();
  enforceRateLimit.mockResolvedValue({ limited: false });
  getCurrentUser.mockResolvedValue(null);
});

describe('setLocale', () => {
  it('writes the locale cookie with the attributes the app depends on', async () => {
    await setLocale('en');
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe('locale');
    expect(value).toBe('en');
    expect(options).toMatchObject({
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
    });
  });

  it('omits `domain` entirely when COOKIE_DOMAIN is unset', async () => {
    // Not `domain: undefined` — a present-but-undefined key is a different object, and
    // some cookie serializers stringify it as the literal "undefined".
    await setLocale('en');
    expect('domain' in cookieSet.mock.calls[0][2]).toBe(false);
  });

  it('marks the cookie Secure only when the app origin is https', async () => {
    // The vitest config pins APP_URL to http://localhost:3000.
    await setLocale('en');
    expect(cookieSet.mock.calls[0][2].secure).toBe(false);
  });

  it('rejects an unsupported locale before doing anything at all', async () => {
    // A Server Action's argument is attacker-controlled regardless of its TypeScript type.
    await setLocale('de' as never);
    await setLocale('../../etc/passwd' as never);
    expect(cookieSet).not.toHaveBeenCalled();
    expect(setUserLocaleMock).not.toHaveBeenCalled();
    expect(enforceRateLimit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('writes nothing when rate limited', async () => {
    enforceRateLimit.mockResolvedValue({ limited: true, retryAfterSec: 30 });
    await setLocale('en');
    expect(cookieSet).not.toHaveBeenCalled();
    expect(setUserLocaleMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('mirrors the choice onto the signed-in user row', async () => {
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    await setLocale('en');
    expect(setUserLocaleMock).toHaveBeenCalledWith(expect.anything(), 'user-1', 'en');
  });

  it('writes no user row when signed out', async () => {
    await setLocale('en');
    expect(setUserLocaleMock).not.toHaveBeenCalled();
  });

  it('still switches the UI when the user-row write fails', async () => {
    // The cookie is already set and the page is about to re-render in the new language;
    // a database error must not throw back into the switcher, which has no error surface.
    getCurrentUser.mockResolvedValue({ id: 'user-1' });
    setUserLocaleMock.mockRejectedValue(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(setLocale('en')).resolves.toBeUndefined();
    expect(cookieSet).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('revalidates the root layout, not just the current route', async () => {
    // `router.refresh()` would re-render only the current route and leave every other
    // entry in the client Router Cache rendered in the previous language.
    await setLocale('en');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

```bash
pnpm test src/i18n/set-locale.test.ts
```
Expected: FAIL — the validation, `httpOnly`, `setUserLocale` and `revalidatePath` assertions all fail against the current implementation. Confirm 9 tests are collected.

- [ ] **Step 9: Implement the hardened `setLocale`**

Replace `src/i18n/set-locale.ts` with:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import { db } from '@/db';
import { env } from '@/env';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { enforceRateLimit } from '@/lib/rate-limit-guard';
import { getClientIp } from '@/lib/request-ip';
import { getCurrentUser } from '@/lib/session';
import { setUserLocale } from '@/lib/user-locale';

import { asLocale, type Locale, LOCALE_COOKIE } from './config';

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale) {
  // A Server Action is a public POST endpoint and its argument is attacker-controlled
  // whatever its TypeScript type says. Validated FIRST so junk cannot spend a
  // rate-limit token, and — more importantly — cannot reach the `user.locale` write.
  const next = asLocale(locale);
  if (!next) return;

  // No auth guard exists on this action — anyone can POST it. Silently doing nothing is
  // the right refusal: the caller is a language switcher with no error surface, and a
  // human cannot reach 60 switches a minute.
  const verdict = await enforceRateLimit([
    { key: `locale:ip:${await getClientIp()}`, rule: RATE_LIMITS.localePerIp },
  ]);
  if (verdict.limited) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, next, {
    maxAge: ONE_YEAR,
    path: '/',
    sameSite: 'lax',
    // Nothing client-side reads this cookie — the browser learns the locale from
    // NextIntlClientProvider, not from document.cookie.
    httpOnly: true,
    // Derived from our own origin, not NODE_ENV: a production-mode build served over
    // plain HTTP would mark the cookie Secure and the browser would drop it silently.
    secure: env.APP_URL.startsWith('https:'),
    // Without this the cookie is host-only, so a language chosen on a club subdomain
    // does not apply on the apex and vice versa — the language would appear to flip as
    // the user moves between their club and the account pages. Every other cookie in
    // the app is already cross-subdomain (see `advanced.crossSubDomainCookies` in
    // `src/auth.ts`, driven by the same variable).
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  });

  // `user.locale` is what transactional email renders from; the cookie is what the UI
  // reads. One action sets both so they cannot disagree. Best-effort: the cookie is
  // already written and the page is about to re-render, so a database failure must not
  // throw back into a control that has no way to report it.
  const user = await getCurrentUser();
  if (user) {
    try {
      await setUserLocale(db, user.id, next);
    } catch (error) {
      console.error('setLocale: failed to persist user.locale', error);
    }
  }

  // NOT `router.refresh()` on the client: that re-renders only the current route and
  // leaves every other entry in the client Router Cache in the previous language, so
  // navigating Back shows the old one. Locale changes every string on every route, so
  // the invalidation is as wide as the change.
  revalidatePath('/', 'layout');
}
```

- [ ] **Step 10: Run the unit test to verify it passes**

```bash
pnpm test src/i18n/set-locale.test.ts
```
Expected: PASS, 9 tests.

- [ ] **Step 11: Repair `rate-limit-wiring.test.ts`**

That suite calls the real `setLocale` 61 times (`src/lib/rate-limit-wiring.test.ts:264-278`). It already mocks `next/headers`, `@/db` (as the literal `{}`), and `@/lib/session` (`getCurrentUser` resolves to a signed-in user, `src/lib/rate-limit-wiring.test.ts:61-64`). The action now additionally reaches `revalidatePath` — called outside a request scope — and, because that session mock reports a signed-in user, `setUserLocale(db, …)` against the `{}` stub, which throws and is swallowed by the new try/catch: 60 console errors of noise on every run. Add two factories alongside the existing ones:

```ts
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/user-locale', () => ({ setUserLocale: vi.fn() }));
```

Leave the existing `@/lib/session` factory alone. Do **not** weaken the existing assertions: the `setLocale` block must still prove the cookie stops being written on call 61.

- [ ] **Step 12: Run the full suite**

```bash
pnpm lint && pnpm test && pnpm test:integration
```
Expected: all green, with the integration run reporting at least 4 more tests than before.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "fix(i18n): validate, scope and persist the locale choice in setLocale"
```

---

### Task 2: `LanguageToggle`, and the theme toggle's untranslated label

**Files:**
- Create (via CLI, unmodified): `src/components/ui/toggle.tsx`, `src/components/ui/toggle-group.tsx`
- Create: `src/components/language-toggle.tsx`
- Create: `src/components/language-toggle.test.tsx`
- Modify: `src/components/theme-toggle.tsx`
- Modify: `src/components/theme-toggle.test.tsx`
- Modify: `messages/tr.json`, `messages/en.json`

**Interfaces:**
- Consumes: `setLocale` from `@/i18n/set-locale` (Task 1), `locales` / `Locale` from `@/i18n/config`.
- Produces: `<LanguageToggle />` — a client component taking no props.

---

- [ ] **Step 1: Add the shadcn primitives via the CLI**

```bash
pnpm dlx shadcn@latest add toggle-group
```

This writes `src/components/ui/toggle-group.tsx` and its dependency `src/components/ui/toggle.tsx`, in the project's `base-nova` style, on `@base-ui/react` (already installed — **not** Radix). **Do not hand-edit either file.** If the CLI prompts about overwriting anything outside `src/components/ui/`, decline.

Verify: `git status` shows exactly those two new files under `src/components/ui/`.

- [ ] **Step 2: Add the message keys**

In **both** `messages/tr.json` and `messages/en.json`, add to the `common` object, keeping keys in the same relative position in both files:

| Key | `messages/tr.json` | `messages/en.json` |
|---|---|---|
| `language` | `Dil` | `Language` |
| `toggleTheme` | `Temayı değiştir` | `Toggle theme` |

- [ ] **Step 3: Write the failing component test**

Create `src/components/language-toggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentLocale = 'tr';

// Key-echo translations, per this repo's component-test convention: this test is about
// which control renders and what it submits, not about copy. Copy is covered by
// src/i18n/messages-parity.test.ts.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => currentLocale,
}));

vi.mock('@/i18n/set-locale', () => ({ setLocale: vi.fn(async () => {}) }));

import { setLocale } from '@/i18n/set-locale';

import { LanguageToggle } from './language-toggle';

describe('LanguageToggle', () => {
  beforeEach(() => { vi.clearAllMocks(); currentLocale = 'tr'; });

  it('shows both languages, named so a speaker of either can find theirs', () => {
    // Autonyms, not translated names: a user who cannot read the current UI language
    // still has to be able to identify their own.
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'Türkçe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
  });

  it('marks the active language pressed and the other not', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'Türkçe' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the other language on click', async () => {
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('en'));
  });

  it('does nothing when the already-active language is clicked', async () => {
    // Base UI's single-select ToggleGroup UNPRESSES the pressed item and reports `[]`.
    // A switcher has no "no language" state; a naive port of the Radix API sends
    // undefined to the server here.
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Türkçe' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('reflects the active language when it is English', () => {
    currentLocale = 'en';
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels the group for assistive technology', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('group', { name: 'language' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

```bash
pnpm test src/components/language-toggle.test.tsx
```
Expected: FAIL — cannot resolve `./language-toggle`. Confirm the runner reports **6 tests**, not `0 tests`; a jsdom suite that dies at module load reports zero and reads like a pass in a summary.

- [ ] **Step 5: Implement the component**

Create `src/components/language-toggle.tsx`:

```tsx
'use client';
import { useLocale, useTranslations } from 'next-intl';
import { useOptimistic, useTransition } from 'react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Locale, locales } from '@/i18n/config';
import { setLocale } from '@/i18n/set-locale';

/**
 * Autonyms — each language named in itself — because a user who cannot read the current
 * UI language still has to be able to find their own. They are identical in both
 * catalogues, so they are a constant here rather than a pair of message keys; only the
 * group's label is prose and therefore translated.
 */
const LANGUAGES: Record<Locale, { short: string; name: string }> = {
  tr: { short: 'TR', name: 'Türkçe' },
  en: { short: 'EN', name: 'English' },
};

export function LanguageToggle() {
  const t = useTranslations('common');
  const active = useLocale() as Locale;
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useOptimistic(active);

  return (
    <ToggleGroup
      aria-label={t('language')}
      aria-busy={pending}
      variant="outline"
      spacing={0}
      value={[shown]}
      onValueChange={(group: string[]) => {
        const next = group[0];
        // Base UI reports `[]` when the pressed item is clicked again — a switcher has
        // no "no language" state. Ignore that, and ignore a click on the active one.
        if (!next || next === shown || pending) return;
        startTransition(async () => {
          setShown(next as Locale);
          await setLocale(next as Locale);
        });
      }}
      className={pending ? 'opacity-60 transition-opacity' : 'transition-opacity'}
    >
      {locales.map((locale) => (
        <ToggleGroupItem
          key={locale}
          value={locale}
          aria-label={LANGUAGES[locale].name}
          className="px-2.5 text-xs font-medium"
        >
          {LANGUAGES[locale].short}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```

Notes for whoever writes this:

- `value` is an **array** and `onValueChange` receives an **array** — this is Base UI, not Radix. The installed type declarations are the authority: `node_modules/@base-ui/react/toggle-group/ToggleGroup.d.ts`.
- Deliberately **not** `disabled` while pending: disabling a focused button drops keyboard focus mid-interaction. The handler's `pending` guard does the same job without that side effect.
- The `size` prop is left at its default (`h-8`), which matches the `size="icon"` (`size-8`) ghost buttons it sits beside in the chrome. Do not set `size="sm"` — it renders `h-7` and visibly mismatches.
- If `useOptimistic` complains that the setter was called outside a transition, the `setShown` call has escaped `startTransition` — it must be the first statement inside it.

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm test src/components/language-toggle.test.tsx
```
Expected: PASS, 6 tests.

If `getByRole('group', …)` fails, inspect what Base UI's `ToggleGroup` actually renders (`node_modules/@base-ui/react/toggle-group/ToggleGroup.js`) and assert against the real role rather than changing the component to satisfy the test. If it renders no `role`, add `role="group"` explicitly to the component — an unlabelled cluster of two buttons is the accessibility gap this assertion exists to prevent.

- [ ] **Step 7: Prove the test can fail**

Temporarily change `if (!next || next === shown || pending) return;` to `if (!next || pending) return;` and re-run. Expected: the "does nothing when the already-active language is clicked" test FAILS. Revert the change. Report the observed failure output — `0 tests` is not a kill.

- [ ] **Step 8: Translate the theme toggle's label**

`src/components/theme-toggle.tsx` hardcodes `aria-label="Toggle theme"` in **both** branches — the pre-mount placeholder and the real button. Every screen-reader user on the Turkish UI hears an English label, on a control that is about to sit directly beside a language picker. Add `const t = useTranslations('common');` (from `next-intl`) and use `t('toggleTheme')` in both places. Change nothing about the `useSyncExternalStore` mount detection.

- [ ] **Step 9: Update the theme toggle's test**

`src/components/theme-toggle.test.tsx` looks the button up by the literal `'Toggle theme'` in both of its cases and will now fail. Add the key-echo `next-intl` mock this repo uses elsewhere:

```tsx
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
```

and look the button up by `'toggleTheme'`. Keep both existing cases and their assertions about the document's theme class — they are what prove the mount detection still works.

- [ ] **Step 10: Run both component suites**

```bash
pnpm test src/components/
```
Expected: PASS — 6 tests for `LanguageToggle`, 2 for `ThemeToggle`, plus the pre-existing ones in that directory.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(i18n): add the TR/EN language toggle"
```

---

### Task 3: `AppControls` and placement

**Files:**
- Create: `src/components/app-controls.tsx`
- Create: `src/components/app-controls.test.tsx`
- Modify: `app/page.tsx`, `app/admin/layout.tsx`, `app/s/[slug]/manage/layout.tsx`, `src/components/member-header.tsx`
- Modify: `app/(auth)/layout.tsx`, `app/s/[slug]/join/page.tsx`, `app/privacy/page.tsx`, `app/request-club/page.tsx`

**Interfaces:**
- Consumes: `<LanguageToggle />` (Task 2), the existing `<ThemeToggle />` and `<SignOutButton redirectTo={string} />`.
- Produces: `<AppControls signOutUrl?: string; children?: ReactNode />`.

---

- [ ] **Step 1: Write the failing test**

Create `src/components/app-controls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'tr',
}));
vi.mock('@/i18n/set-locale', () => ({ setLocale: vi.fn() }));
vi.mock('@/auth-client', () => ({ authClient: { signOut: vi.fn() } }));

import { AppControls } from './app-controls';

describe('AppControls', () => {
  it('always offers language and theme', () => {
    render(<AppControls />);
    expect(screen.getByRole('group', { name: 'language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'toggleTheme' })).toBeInTheDocument();
  });

  it('offers sign-out only when a sign-out target is given', () => {
    const { rerender } = render(<AppControls />);
    expect(screen.queryByRole('button', { name: 'signOut' })).not.toBeInTheDocument();
    rerender(<AppControls signOutUrl="https://example.test/sign-in" />);
    expect(screen.getByRole('button', { name: 'signOut' })).toBeInTheDocument();
  });

  it('renders the leading slot before the toggles', () => {
    // The manage layout puts the account link here; it must not land between the
    // language and theme controls, which are a visual pair.
    render(<AppControls><a href="/x">account</a></AppControls>);
    const rendered = screen.getByRole('group', { name: 'language' }).parentElement!;
    const order = Array.from(rendered.children).map((c) => c.textContent);
    expect(order[0]).toBe('account');
  });
});
```

The `toggleTheme` name comes from Task 2's change to `ThemeToggle` plus the key-echo mock — `useTranslations('common')` echoes the key it is called with, not the dotted path. `signOut` is the pre-existing key `SignOutButton` already uses.

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test src/components/app-controls.test.tsx
```
Expected: FAIL — cannot resolve `./app-controls`. Confirm 3 tests are collected.

- [ ] **Step 3: Implement `AppControls`**

Create `src/components/app-controls.tsx`:

```tsx
import type { ReactNode } from 'react';

import { LanguageToggle } from '@/components/language-toggle';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * The page-chrome control cluster, in one place.
 *
 * This pairing repeats on eight surfaces. Owning it here is what keeps their order and
 * spacing identical, and means the next control added to the chrome lands on all eight
 * at once instead of on whichever ones someone remembered.
 *
 * Order is deliberate: the text control first, then icons, so the row reads
 * left-to-right from widest to narrowest and the icon buttons stay adjacent.
 */
export function AppControls({
  signOutUrl,
  children,
}: {
  signOutUrl?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {children}
      <LanguageToggle />
      <ThemeToggle />
      {signOutUrl ? <SignOutButton redirectTo={signOutUrl} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm test src/components/app-controls.test.tsx
```
Expected: PASS on the sign-out and ordering tests. The theme-label assertion passes only once Task 4 lands; if it fails on exactly that, say so in the report and continue.

- [ ] **Step 5: Replace the existing clusters**

Four sites already have a cluster. Replace each with `<AppControls>`, deleting the now-unused `ThemeToggle` / `SignOutButton` imports (lint will flag any you miss).

`app/page.tsx` — signed-out branch, replace the bare `<ThemeToggle />`:

```tsx
<div className="flex w-full items-center justify-between">
  <span className="font-heading text-2xl font-bold text-brand">{t('appName')}</span>
  <AppControls />
</div>
```

`app/page.tsx` — signed-in branch, replace the `<div className="flex items-center gap-1">…</div>`:

```tsx
<AppControls signOutUrl={apexUrl('/sign-in?signedout=1', origin)} />
```

`app/admin/layout.tsx` — replace the `<div className="flex items-center gap-1">…</div>` with:

```tsx
<AppControls signOutUrl={signOutUrl} />
```

`src/components/member-header.tsx` — replace the `<div className="flex shrink-0 items-center gap-1">…</div>` with:

```tsx
<AppControls signOutUrl={signOutUrl} />
```

`app/s/[slug]/manage/layout.tsx` — the account link becomes the leading slot; keep the link's markup and comment exactly as they are today:

```tsx
<AppControls signOutUrl={apexUrl('/sign-in?signedout=1', origin)}>
  {/*
    Absolute apex link (not <Link>): the owner is on the club subdomain, so
    a relative href would stay on the tenant host. The apex home is where
    the account identity and the user's other clubs live.
  */}
  <a
    href={apexUrl('/', origin)}
    className="max-w-40 truncate rounded-field px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
    title={user.email}
  >
    {user.name || user.email}
  </a>
</AppControls>
```

- [ ] **Step 6: Give the three chrome-less surfaces a control row**

`app/(auth)/layout.tsx` — this wraps sign-in, sign-up, forgot-password, reset-password and verify-email. It is where a first-time visitor lands, in a language they did not choose, with no account yet:

```tsx
import type { ReactNode } from 'react';

import { AppControls } from '@/components/app-controls';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-6 p-6">
      {/* Absolutely positioned, not in flow: this column is vertically centred, so an
          in-flow control row would ride down with the card and sit in the middle of the
          screen instead of reading as page chrome. */}
      <div className="absolute top-4 right-4">
        <AppControls />
      </div>
      {children}
    </main>
  );
}
```

`app/s/[slug]/join/page.tsx` — **both** returned `<main>` blocks (the signed-out branch and the membership-status branch). An invite link is the one URL a club shares with people who have never seen the product. Both are vertically centred like the auth layout, so use the same treatment: add `relative` to each `<main>`'s classes and insert, as its first child:

```tsx
<div className="absolute top-4 right-4">
  <AppControls />
</div>
```

`app/privacy/page.tsx`:

```tsx
<main className="mx-auto max-w-2xl p-8">
  <div className="mb-4 flex w-full justify-end">
    <AppControls />
  </div>
  <h1 className="mb-4 font-heading text-2xl font-bold">{t('title')}</h1>
  <p className="text-muted-foreground">{t('stub')}</p>
</main>
```

- [ ] **Step 7: Fix the unwrapped `request-club` page**

`app/request-club/page.tsx` has no layout of its own and returns a bare `<div className="w-full">`, so it renders edge-to-edge against the viewport with no padding or max-width while every sibling page is wrapped. Wrap **both** returned branches (the `submitted === '1'` branch and the default one), replacing `<div className="w-full">` with:

```tsx
<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-8">
```

Keep the inner content unchanged, and close with `</main>`. This page is behind `requireUser`, so it needs no control row of its own — but check the rendered result rather than assuming the wrapper looks right.

- [ ] **Step 8: Verify every surface**

```bash
pnpm lint && pnpm test
```
Then confirm by reading the diff that all eight surfaces from the spec's §4.4 table render `<AppControls>`, and that no `ThemeToggle` import remains anywhere except inside `app-controls.tsx` and its own test:

```bash
grep -rn "ThemeToggle" --include=*.tsx app src | grep -v "theme-toggle"
```
Expected: matches only in `src/components/app-controls.tsx`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(i18n): put the language switcher on every user-reachable surface"
```

---

### Task 4: Close the coverage gaps the switcher exposes

**Files:**
- Modify: `app/layout.tsx`
- Modify: `messages/tr.json`, `messages/en.json`

**Interfaces:**
- Consumes: the `common.appDescription` message key, added here.
- Produces: nothing new; this task removes hardcoded copy.

---

- [ ] **Step 1: Add the message key**

To the `common` object in **both** catalogues, in the same relative position:

| Key | `messages/tr.json` | `messages/en.json` |
|---|---|---|
| `appDescription` | `Kürek kulüpleri için seans ve rezervasyon yönetimi.` | `Session and booking management for rowing clubs.` |

- [ ] **Step 2: Make the document description follow the locale**

`app/layout.tsx` exports a static `metadata` whose `description` is Turkish prose. Replace it with:

```ts
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return { title: t('appName'), description: t('appDescription') };
}
```

`getTranslations` is imported from `next-intl/server`; the file already imports `getLocale` from there. Delete the old `export const metadata` and its now-unused import if `Metadata` is no longer referenced — lint will tell you.

- [ ] **Step 3: Sweep for anything else hardcoded**

Search the non-test, non-`ui/` sources for user-facing literals that never reached a catalogue:

```bash
grep -rnE '(aria-label|title|placeholder|alt)="[^"{]{2,}"' --include=*.tsx app src/components src/emails \
  | grep -v '\.test\.' | grep -v 'src/components/ui/'
```

Judgement, not a blanket rewrite: `placeholder="instagram"`, `placeholder="bebekrowing"` and `placeholder="boat."` are illustrative example values, not prose — leave them. Anything that reads as a sentence or an instruction becomes a key in both catalogues. Also skim the JSX text nodes of the files you touched in Task 3 for stray literals. Report what you found and what you deliberately left, with the reason.

- [ ] **Step 4: Run everything**

```bash
pnpm lint && pnpm test && pnpm test:integration
```
Expected: all green — including `src/i18n/messages-parity.test.ts`, which fails loudly if a key landed in only one catalogue.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(i18n): translate the theme label and the document description"
```

---

## Verification checklist (whole branch)

- [ ] `pnpm lint && pnpm test && pnpm test:integration` all green.
- [ ] `grep -rn "ThemeToggle" --include=*.tsx app src | grep -v theme-toggle` matches only `app-controls.tsx`.
- [ ] All eight surfaces in the spec's §4.4 table render `<AppControls>`.
- [ ] No file under `src/components/ui/` has been hand-edited (`git diff main -- src/components/ui/` shows only the two CLI-added files, added whole).
- [ ] `messages/tr.json` and `messages/en.json` both gained exactly `common.language`, `common.toggleTheme`, `common.appDescription`.
- [ ] No migration was generated; `drizzle/` is untouched.
