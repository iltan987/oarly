import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { type Locale, locales } from '@/i18n/config';

import type trCatalog from '../../messages/tr.json';

/**
 * The settings index's policies row, formatted through the REAL catalogues.
 *
 * Every component test in this repo mocks next-intl and asserts on key names, so
 * `settings/page.test.tsx` can prove the page passes `waitlist: "off"` and prove nothing
 * whatsoever about what an owner reads. A catalogue with no `off` branch would silently
 * fall through to `other` and render "yedek listesi en fazla 0 kişi" — a different lie
 * from the one review caught, told by a page whose tests are all green.
 *
 * So this formats the message and compares the three states to each other.
 *
 * The distinction being defended, from `src/lib/booking.ts:178`
 * (`waitlistCapacity == null ? Infinity : capacity + waitlistCapacity`):
 *
 * - **null** — the waitlist is unbounded.
 * - **0** — there is no waitlist; a session accepts its seats and nothing more.
 *
 * They are opposite settings, and `?? 0` collapsed them onto one sentence. `0` is reachable
 * (`src/lib/schemas.ts:148` is `.min(0)`, the form's input is `min={0}`), so this is what an
 * owner who switched waitlisting off is told.
 *
 * The catalogue's VALUE is read off disk at run time — the point of this file is to format
 * what ships, not what a bundler inlined — while its TYPE comes from the same file at
 * compile time, so `t('policiesSummary')` is checked rather than inferred as `never`.
 */
type Catalog = typeof trCatalog;

function messages(locale: Locale): Catalog {
  const path = fileURLToPath(new URL(`../../messages/${locale}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
}

function summary(locale: Locale, waitlist: string, waitlistCap: number): string {
  const t = createTranslator({ locale, messages: messages(locale), namespace: 'manage.settings' });
  return t('policiesSummary', { mode: 'lead', leadDays: 3, selfCancel: 'on', waitlist, waitlistCap });
}

describe.each(locales)('the %s policies summary', (locale) => {
  it('says something different for an unlimited waitlist, no waitlist, and a capped one', () => {
    const unlimited = summary(locale, 'unlimited', 0);
    const off = summary(locale, 'off', 0);
    const capped = summary(locale, 'capped', 5);
    // Three states, three sentences. This is the assertion the `?? 0` bug would have
    // failed: it made the first two identical.
    expect(new Set([unlimited, off, capped]).size).toBe(3);
    // And none of them fell through to an unrendered branch or an empty string.
    for (const line of [unlimited, off, capped]) expect(line.trim().length).toBeGreaterThan(0);
  });

  it('puts the number in the capped sentence and in neither of the others', () => {
    expect(summary(locale, 'capped', 7)).toContain('7');
    // The control: the two non-numeric branches are handed a cap and must not print it,
    // or "no waitlist" would read as a limit of zero.
    expect(summary(locale, 'unlimited', 7)).not.toContain('7');
    expect(summary(locale, 'off', 7)).not.toContain('7');
  });

  it('leaves no unformatted ICU behind in any state', () => {
    // A missing branch does not throw — ICU falls through to `other`. A malformed one
    // leaves braces, or leaks an argument NAME into the sentence. Deliberately not a
    // word-list check on the selectors: "capped" is real English prose in this very
    // message ("waitlist not capped"), so a naive sweep would fail on correct copy, and a
    // check that cries wolf on correct input gets deleted.
    for (const state of ['unlimited', 'off', 'capped']) {
      const line = summary(locale, state, 5);
      expect(line).not.toMatch(/[{}]/);
      expect(line).not.toMatch(/waitlistCap|selfCancel|leadDays/);
    }
  });

  it('formats the other two clauses too, so this row is read end to end', () => {
    // The lead-days plural and the self-cancel select share this message. A change that
    // broke either would otherwise only surface as a runtime throw in production.
    expect(summary(locale, 'capped', 5)).toContain('3');
    const always = createTranslator({
      locale,
      messages: messages(locale),
      namespace: 'manage.settings',
    })('policiesSummary', { mode: 'always', leadDays: 0, selfCancel: 'off', waitlist: 'capped', waitlistCap: 5 });
    expect(always).not.toBe(summary(locale, 'capped', 5));
    expect(always).not.toContain('{');
  });
});
