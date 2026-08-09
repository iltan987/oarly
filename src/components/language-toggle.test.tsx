// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/**
 * Segments are matched by an accessible name that STARTS WITH the visible text — the
 * WCAG 2.5.3 property itself (the name must contain the label, not replace it) — rather
 * than by an exact string, because the separator between the two is environment-defined.
 *
 * `dom-accessibility-api` joins children with `display !== "inline" ? " " : ""`
 * (dist/accessible-name-and-description.js:252-255). jsdom loads no CSS, so the `sr-only`
 * span computes as `inline` and the name comes out `TRTürkçe`; in a browser `sr-only`'s
 * `position: absolute` blockifies it and the name is `TR Türkçe`. Both satisfy 2.5.3 and
 * both match these patterns. Do not "fix" them into exact strings — that would make the
 * suite assert a jsdom artefact. `textContent` (asserted below) is where the exact
 * rendered text, spacing included, is pinned.
 */
const TR = /^TR/;
const EN = /^EN/;

/**
 * Hand back a `setLocale` that hangs until the returned `resolve` is called, so a test
 * can observe the component mid-transition. Without this the action settles inside
 * `fireEvent`'s own `act()` and the optimistic state is gone before any assertion runs —
 * which is exactly why the optimistic mechanism went unverified.
 */
function deferSetLocale() {
  let release!: () => void;
  const settled = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(setLocale).mockImplementation(() => settled);
  return async () => { await act(async () => { release(); await settled; }); };
}

describe('LanguageToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` clears call history but NOT implementations, and this config sets
    // no `restoreMocks`/`mockReset`. Without an explicit reset a deferred promise
    // installed by one test would hang every test after it.
    vi.mocked(setLocale).mockReset();
    vi.mocked(setLocale).mockResolvedValue(undefined);
    currentLocale = 'tr';
  });

  it('shows both languages, named so a speaker of either can find theirs', () => {
    // Autonyms, not translated names: a user who cannot read the current UI language
    // still has to be able to identify their own. Matched on the autonym here (rather
    // than the visible abbreviation) so that dropping the hidden autonym fails this
    // test rather than passing on the abbreviation alone.
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: /Türkçe/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /English/ })).toBeInTheDocument();
  });

  it('keeps the visible text inside the accessible name (WCAG 2.5.3)', () => {
    // An `aria-label` of the autonym alone REPLACES the name: the button reads `TR` on
    // screen but answers only to "Türkçe", so a Voice Control / Voice Access / Dragon
    // user saying "click TR" gets no match. The defect is asymmetric — `EN` would slip
    // through unnoticed because "English" contains "en" — so both segments are pinned,
    // and `EN`'s pattern is deliberately case-sensitive for that reason.
    render(<LanguageToggle />);
    const tr = screen.getByRole('button', { name: TR });
    const en = screen.getByRole('button', { name: EN });
    expect(tr).toHaveAccessibleName(/^TR/);
    expect(en).toHaveAccessibleName(/^EN/);
    // The exact rendered text, separator included — the half jsdom's accname
    // implementation cannot show (see the note on TR/EN above).
    expect(tr).toHaveTextContent('TR Türkçe');
    expect(en).toHaveTextContent('EN English');
  });

  it('marks the active language pressed and the other not', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: TR })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: EN })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to the other language on click', async () => {
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: EN }));
    await waitFor(() => expect(setLocale).toHaveBeenCalledWith('en'));
  });

  it('does nothing when the already-active language is clicked', async () => {
    // Base UI's single-select ToggleGroup UNPRESSES the pressed item and reports `[]`.
    // A switcher has no "no language" state; a naive port of the Radix API sends
    // undefined to the server here.
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: TR }));
    await new Promise((r) => setTimeout(r, 0));
    expect(setLocale).not.toHaveBeenCalled();
  });

  it('reflects the active language when it is English', () => {
    currentLocale = 'en';
    render(<LanguageToggle />);
    expect(screen.getByRole('button', { name: EN })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels the group for assistive technology', () => {
    render(<LanguageToggle />);
    expect(screen.getByRole('group', { name: 'language' })).toBeInTheDocument();
  });

  it('moves the pressed state to the clicked language before the server answers', async () => {
    // The whole point of `useOptimistic` here: the switch is a full-layout revalidate,
    // so without this the control sits visibly unchanged for a round trip and invites a
    // second click. Rendering `value={[active]}` instead of `value={[shown]}` removes
    // the optimism entirely while leaving every other test green — this is the assertion
    // that notices.
    const settle = deferSetLocale();
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: EN }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: EN })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: TR })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'language' })).toHaveAttribute('aria-busy', 'true');

    await settle();
  });

  it('reverts to the server locale when the switch is refused', async () => {
    // `setLocale` refuses silently when rate limited — it returns without writing the
    // cookie, so the re-render still reports `tr`. The optimistic value must fall back
    // to it rather than stick, or the control would claim a language the server never
    // accepted. `useLocale` is pinned to 'tr' throughout, which is exactly that case.
    const settle = deferSetLocale();
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: EN }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: EN })).toHaveAttribute('aria-pressed', 'true'));

    await settle();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: TR })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: EN })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('group', { name: 'language' })).toHaveAttribute('aria-busy', 'false');
  });

  it('ignores a second click while the first switch is still in flight', async () => {
    // The `pending` clause of the guard. Once the optimistic state has moved to EN, the
    // TR segment is no longer pressed, so a click on it is a legitimate value change as
    // far as Base UI is concerned — only `pending` stops it reaching the server. Dropping
    // that clause spends a second rate-limit token and races two full-layout revalidates
    // whose order decides the final language.
    const settle = deferSetLocale();
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: EN }));
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'language' })).toHaveAttribute('aria-busy', 'true'));

    fireEvent.click(screen.getByRole('button', { name: TR }));

    await settle();
    expect(setLocale).toHaveBeenCalledTimes(1);
    expect(setLocale).toHaveBeenCalledWith('en');
  });

  it('stays on the page when the action itself rejects', async () => {
    // `setLocale` swallows its own DB errors, but a transport failure rejects here. An
    // unhandled rejection inside `startTransition` escalates to the nearest error
    // boundary — swapping a language switcher for an error screen. The revert is the
    // only feedback this control has, and it must still happen.
    vi.mocked(setLocale).mockRejectedValue(new Error('offline'));
    render(<LanguageToggle />);
    fireEvent.click(screen.getByRole('button', { name: EN }));

    // Wait on `aria-busy`, not on the pressed state: the transition ending is the event
    // this test is about, and the pressed state can already read `tr` before it.
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'language' })).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByRole('button', { name: TR })).toHaveAttribute('aria-pressed', 'true');
    expect(setLocale).toHaveBeenCalledWith('en');
  });
});
