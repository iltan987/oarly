// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let currentLocale = 'tr';

// Key-echo translations, per this repo's component-test convention: this file is about
// which controls render and what they submit, not about copy. Copy is covered by
// src/i18n/messages-parity.test.ts.
//
// `useLocale` as well as `useTranslations`: a `vi.mock` factory REPLACES the whole module,
// so any component pulled into this tree that reaches for another next-intl hook would get
// `undefined is not a function` rather than a missing translation.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => currentLocale,
}));

vi.mock('@/i18n/set-locale', () => ({ setLocale: vi.fn(async () => {}) }));
vi.mock('@/auth-client', () => ({ authClient: { signOut: vi.fn(async () => {}) } }));

import { authClient } from '@/auth-client';
import { ThemeProvider } from '@/components/theme-provider';
import { setLocale } from '@/i18n/set-locale';

import { UserMenu, type UserMenuSession } from './user-menu';

const SESSION: UserMenuSession = {
  name: 'İltan Caner',
  email: 'icaner@example.test',
  accountUrl: 'https://oarly.test/account',
  signOutUrl: 'https://oarly.test/sign-in?signedout=1',
};

/**
 * The popup is portalled and `MenuPortal.keepMounted` defaults to `false`, so nothing
 * inside the menu exists in the DOM until the trigger is pressed. Every popup assertion in
 * this file goes through here; a test that forgets it queries an empty document and
 * "passes" for the wrong reason.
 */
async function openMenu(triggerName: string) {
  fireEvent.click(screen.getByRole('button', { name: triggerName }));
  return await screen.findByRole('menu');
}

function renderMenu(ui: ReactElement, { theme = 'system' } = {}) {
  return render(
    <ThemeProvider attribute="class" defaultTheme={theme}>
      {ui}
    </ThemeProvider>,
  );
}

/**
 * Hand back a `setLocale` that hangs until the returned `release` is called, so a test can
 * observe the component mid-transition. Without this the action settles inside
 * `fireEvent`'s own `act()` and the optimistic state is gone before any assertion runs.
 * Ported from `language-toggle.test.tsx`, where it exists for the same reason.
 */
let releaseDeferred: (() => void) | null = null;

function deferSetLocale() {
  let release!: () => void;
  const settled = new Promise<void>((resolve) => { release = resolve; });
  releaseDeferred = release;
  vi.mocked(setLocale).mockImplementation(() => settled);
  return async () => {
    releaseDeferred = null;
    await act(async () => { release(); await settled; });
  };
}

const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!;

/**
 * Base UI reports primitive misuse through `console.error` ("Base UI: ..."), never by
 * throwing, and several of its rules leave no trace in the DOM at all — `nativeButton`
 * on the `<a>`-rendered account row is one: the rendered element is byte-identical with
 * and without it, so nothing queryable can pin it. Its only observable consequence is
 * this message.
 *
 * Asserted file-wide rather than in one test, because `@base-ui/utils/error` dedupes each
 * message globally for the lifetime of the module: whichever test renders first is the
 * only one that would ever see a given complaint, so a check scoped to a single test
 * would silently stop working as soon as another test was added above it.
 */
const baseUiComplaints: string[] = [];

/**
 * Make `new window.Image()` report a successful load. jsdom loads no resources, so Base
 * UI's avatar preload sits at `loading` forever and `Avatar.Image` never renders its
 * `<img>`. Returns an undo.
 */
function loadImagesInstantly() {
  const RealImage = window.Image;
  class InstantImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    complete = false;
    naturalWidth = 1;
    crossOrigin: string | null = null;
    referrerPolicy = '';
    sizes = '';
    srcset = '';
    #src = '';
    get src() { return this.#src; }
    set src(value: string) {
      this.#src = value;
      queueMicrotask(() => this.onload?.());
    }
  }
  window.Image = InstantImage as unknown as typeof window.Image;
  return () => { window.Image = RealImage; };
}

describe('UserMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` clears call history but NOT implementations, and this config sets no
    // `restoreMocks`/`mockReset`. Without an explicit reset a deferred promise installed by
    // one test would hang every test after it.
    vi.mocked(setLocale).mockReset();
    vi.mocked(setLocale).mockResolvedValue(undefined);
    vi.mocked(authClient.signOut).mockReset();
    vi.mocked(authClient.signOut).mockResolvedValue(undefined as never);
    currentLocale = 'tr';
    localStorage.clear();
    document.documentElement.className = '';
    baseUiComplaints.length = 0;
    // Installed after `clearAllMocks`, which would otherwise wipe it.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('Base UI:')) {
        baseUiComplaints.push(args[0]);
      }
    });
  });

  afterEach(() => {
    const complaints = [...baseUiComplaints];
    vi.mocked(console.error).mockRestore();
    Object.defineProperty(window, 'location', realLocation);
    // A `deferSetLocale` whose `settle()` never ran — because an assertion threw first —
    // leaves a React transition permanently in flight, and React's transition lane is
    // shared: the NEXT test's transition then never completes either, so one genuine
    // failure cascades into two bogus ones and the mutation report reads as if the wrong
    // assertions were doing the work. Verified: it turned a single real kill into three.
    releaseDeferred?.();
    releaseDeferred = null;
    // A thrown error rather than `expect`, which `vitest/no-standalone-expect` forbids in a
    // hook. Last, so the cleanup above always runs.
    if (complaints.length > 0) throw new Error(complaints.join('\n'));
  });

  describe('guest', () => {
    it('offers preferences and nothing account-shaped', async () => {
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');

      expect(within(menu).getByRole('group', { name: 'language' })).toBeInTheDocument();
      expect(within(menu).getByRole('group', { name: 'theme' })).toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'account' })).not.toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'signOut' })).not.toBeInTheDocument();
      // The identity header would be the only other thing carrying an email address.
      expect(within(menu).queryByText(SESSION.email)).not.toBeInTheDocument();
    });

    it('names its trigger for the preferences it holds, not for an account it has none of', () => {
      renderMenu(<UserMenu />);
      const trigger = screen.getByRole('button', { name: 'preferences' });
      expect(screen.queryByRole('button', { name: SESSION.name })).not.toBeInTheDocument();
      // An icon-only button with no icon is an empty 32px box that nobody clicks. Asserted
      // on the trigger's own subtree, where the only svg is the glyph itself.
      expect(trigger.querySelector('svg')).toHaveClass('lucide-sliders-horizontal');
    });
  });

  describe('signed in', () => {
    it('shows the identity, the account link and sign out', async () => {
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);

      expect(within(menu).getByText(SESSION.name)).toBeInTheDocument();
      expect(within(menu).getByText(SESSION.email)).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'account' }))
        .toHaveAttribute('href', SESSION.accountUrl);
      expect(within(menu).getByRole('menuitem', { name: 'signOut' })).toBeInTheDocument();
      // Preferences are not an either/or with identity: a signed-in user keeps both.
      expect(within(menu).getByRole('group', { name: 'language' })).toBeInTheDocument();
      expect(within(menu).getByRole('group', { name: 'theme' })).toBeInTheDocument();
    });

    it('names the trigger after the person, not after their initials', () => {
      // "İC" read aloud identifies nobody. The initials are the visual token; the
      // accessible name has to be the name.
      renderMenu(<UserMenu session={SESSION} />);
      const trigger = screen.getByRole('button', { name: SESSION.name });
      expect(trigger).toHaveTextContent('İC');
    });

    it('shows the initials when there is no image', () => {
      renderMenu(<UserMenu session={SESSION} />);
      const trigger = screen.getByRole('button', { name: SESSION.name });
      expect(trigger).toHaveTextContent('İC');
      expect(trigger.querySelector('img')).toBeNull();
    });

    it('shows the photo once it loads, in place of the initials', async () => {
      // Base UI's `Avatar.Image` renders nothing until the preload it kicks off
      // (`useImageLoadingStatus` -> `new window.Image()`) reports `loaded`. jsdom fetches
      // no resources, so that callback never fires on its own and the <img> is
      // unobservable — which would let the whole `session.image` branch be deleted with
      // every test still green. `loadImagesInstantly` is what makes the branch reachable.
      const restore = loadImagesInstantly();
      try {
        renderMenu(<UserMenu session={{ ...SESSION, image: 'https://cdn.test/me.png' }} />);
        const trigger = screen.getByRole('button', { name: SESSION.name });
        const img = await waitFor(() => {
          const found = trigger.querySelector('img');
          expect(found).not.toBeNull();
          return found!;
        });
        expect(img).toHaveAttribute('src', 'https://cdn.test/me.png');
        // `alt=""`: the accessible name is the trigger's own aria-label, and an alt of the
        // user's name would only repeat it into the same name.
        expect(img).toHaveAttribute('alt', '');
        expect(trigger).toHaveAccessibleName(SESSION.name);
      } finally {
        restore();
      }
    });
  });

  it('renders both triggers at the same width', () => {
    // `app/s/[slug]/page.tsx` renders for guests and for members on the same route. If the
    // two triggers differed in width, that page's header would shift between the two
    // renders — the defect this whole component exists to remove, at smaller scale.
    //
    // Asserted on the trigger elements themselves, never via a `.size-8` container query:
    // `size-8` is baked into shadcn's button and avatar primitives, so a subtree search
    // matches something no matter which element actually carries it.
    const { unmount } = renderMenu(<UserMenu />);
    expect(screen.getByRole('button', { name: 'preferences' })).toHaveClass('size-8');
    unmount();

    renderMenu(<UserMenu session={SESSION} />);
    expect(screen.getByRole('button', { name: SESSION.name })).toHaveClass('size-8');
  });

  describe('popup', () => {
    it('names itself, rather than borrowing the trigger`s name', async () => {
      // Base UI points the popup`s `aria-labelledby` at the trigger by default, which for
      // a signed-in user would announce the menu as the person`s own name. The explicit
      // label is what makes it "account and preferences".
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      expect(menu).toHaveAccessibleName('userMenu');
    });

    it('sizes itself independently of the 32px trigger and hangs off its end', async () => {
      // The shadcn popup is `w-(--anchor-width)` — it matches the trigger — and this
      // trigger is `size-8`, so without the override the whole menu renders 32px wide.
      // `align="end"` is the other half: the trigger sits at the right edge of the page
      // chrome, so a start-aligned popup opens off the viewport.
      //
      // Asserted on the popup element itself. A `container.querySelector('.w-56')` would
      // be worthless here — and so would asserting `w-56` alone, since tailwind-merge
      // silently keeping BOTH widths is the exact failure being ruled out.
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      expect(menu).toHaveClass('w-56');
      expect(menu.className).not.toContain('--anchor-width');
      expect(menu).toHaveAttribute('data-align', 'end');
    });

    it('lays the signed-in menu out in the specified order', async () => {
      // The whole point of the component is that this cluster is identical everywhere, so
      // its order is part of the contract rather than an accident of JSX. Read off the
      // primitives' own `data-slot`s, which is the one description that survives copy
      // changes and translation.
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      const rows = new Set([
        'dropdown-menu-label',
        'dropdown-menu-separator',
        'dropdown-menu-item',
        'dropdown-menu-radio-item',
      ]);
      const shape = Array.from(menu.querySelectorAll<HTMLElement>('[data-slot]'))
        .filter((el) => rows.has(el.dataset.slot ?? ''))
        .map((el) => `${el.dataset.slot}:${el.textContent}`);

      expect(shape).toEqual([
        'dropdown-menu-label:İltan Canericaner@example.test',
        'dropdown-menu-separator:',
        'dropdown-menu-item:account',
        'dropdown-menu-separator:',
        'dropdown-menu-label:language',
        'dropdown-menu-radio-item:Türkçe',
        'dropdown-menu-radio-item:English',
        'dropdown-menu-separator:',
        'dropdown-menu-label:theme',
        'dropdown-menu-radio-item:themeLight',
        'dropdown-menu-radio-item:themeDark',
        'dropdown-menu-radio-item:themeSystem',
        'dropdown-menu-separator:',
        'dropdown-menu-item:signOut',
      ]);
    });

    it('subordinates the email to the name in the identity header', async () => {
      // The name is the identity; the email is the disambiguator for someone with two
      // accounts. Asserted on the element that actually holds the email text — its
      // `parentElement` is the label and its subtree is a text node, so neither could
      // absorb a class the span itself lost.
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      const email = within(menu).getByText(SESSION.email);
      expect(email).toHaveClass('text-xs', 'text-muted-foreground');
      expect(within(menu).getByText(SESSION.name)).not.toHaveClass('text-muted-foreground');
    });

    it('marks sign out as the destructive row', async () => {
      // It is the one item here that throws work away; it reads differently on purpose.
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      expect(within(menu).getByRole('menuitem', { name: 'signOut' }))
        .toHaveAttribute('data-variant', 'destructive');
      expect(within(menu).getByRole('menuitem', { name: 'account' }))
        .toHaveAttribute('data-variant', 'default');
    });
  });

  describe('language', () => {
    it('offers both languages by autonym, with the active one selected', async () => {
      // Autonyms, not translated names: a user who cannot read the current UI language
      // still has to be able to identify their own.
      const menu = await (renderMenu(<UserMenu />), openMenu('preferences'));
      expect(within(menu).getByRole('menuitemradio', { name: 'Türkçe' }))
        .toHaveAttribute('aria-checked', 'true');
      expect(within(menu).getByRole('menuitemradio', { name: 'English' }))
        .toHaveAttribute('aria-checked', 'false');
    });

    it('reflects the active language when it is English', async () => {
      currentLocale = 'en';
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      expect(within(menu).getByRole('menuitemradio', { name: 'English' }))
        .toHaveAttribute('aria-checked', 'true');
    });

    it('submits the language that was picked, exactly once', async () => {
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));

      await waitFor(() => expect(setLocale).toHaveBeenCalledWith('en'));
      expect(setLocale).toHaveBeenCalledTimes(1);
    });

    it('does not resubmit the language that is already selected', async () => {
      // THE GUARD TEST. Under the old `ToggleGroup` this case was unreachable: Base UI's
      // single-select group unpresses the pressed item and reports `[]`, so the `!next`
      // clause swallowed it and `next === shown` could never fire.
      //
      // `MenuRadioItem` is different, and the difference is why the guard is now
      // load-bearing: its click handler calls `setSelectedValue(value, details)` with no
      // `checked` check (radio-item/MenuRadioItem.js), and `MenuRadioGroup.setValue`
      // forwards straight to `onValueChange` (radio-group/MenuRadioGroup.js). Re-picking
      // the current language really does re-fire with the same value, and unguarded that
      // is a cookie write, a `localePerIp` rate-limit token, a `user.locale` UPDATE and a
      // full-layout revalidate for a no-op.
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      const turkish = within(menu).getByRole('menuitemradio', { name: 'Türkçe' });
      expect(turkish).toHaveAttribute('aria-checked', 'true');

      fireEvent.click(turkish);
      await act(async () => { await Promise.resolve(); });
      expect(setLocale).not.toHaveBeenCalled();

      // Positive control, deliberately inside this test rather than trusting a sibling:
      // the same mock, the same handler, the same open menu, one row over. Without it,
      // "zero calls" is equally satisfied by a `setLocale` that was never wired up, a menu
      // that never opened, or a row Base UI never attached a click handler to — and the
      // assertion above would survive deleting the guard it exists to protect.
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));
      await waitFor(() => expect(setLocale).toHaveBeenCalledTimes(1));
      expect(setLocale).toHaveBeenCalledWith('en');
    });

    it('moves the selection to the picked language before the server answers', async () => {
      // The whole point of `useOptimistic` here: the switch is a full-layout revalidate, so
      // without it the menu sits visibly unchanged for a round trip and invites a second
      // pick. Rendering `value={activeLocale}` instead of `value={shownLocale}` removes the
      // optimism entirely while leaving every other test green — this is what notices.
      const settle = deferSetLocale();
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));

      await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'English' }))
        .toHaveAttribute('aria-checked', 'true'));
      expect(within(menu).getByRole('menuitemradio', { name: 'Türkçe' }))
        .toHaveAttribute('aria-checked', 'false');

      // The busy state and the dimming are asserted on the language group ITSELF, by role
      // and accessible name — not by hunting for `.opacity-60` in the subtree.
      const group = within(menu).getByRole('group', { name: 'language' });
      expect(group).toHaveAttribute('aria-busy', 'true');
      expect(group).toHaveClass('opacity-60');

      await settle();
    });

    it('reverts to the server locale when the switch is refused', async () => {
      // `setLocale` refuses silently when rate limited — it returns without writing the
      // cookie, so the re-render still reports `tr`. The optimistic value must fall back to
      // it rather than stick, or the menu would claim a language the server never accepted.
      // `useLocale` is pinned to 'tr' throughout, which is exactly that case.
      const settle = deferSetLocale();
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));
      await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'English' }))
        .toHaveAttribute('aria-checked', 'true'));

      await settle();

      await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: 'Türkçe' }))
        .toHaveAttribute('aria-checked', 'true'));
      const group = within(menu).getByRole('group', { name: 'language' });
      expect(group).toHaveAttribute('aria-busy', 'false');
      expect(group).not.toHaveClass('opacity-60');
    });

    it('ignores a second pick while the first switch is still in flight', async () => {
      // The `pending` clause. Once the optimistic value has moved to EN, Türkçe is no
      // longer the selected row, so picking it is a legitimate value change as far as Base
      // UI is concerned — only `pending` stops it reaching the server. Dropping that clause
      // spends a second rate-limit token and races two full-layout revalidates whose order
      // decides the final language.
      const settle = deferSetLocale();
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));
      await waitFor(() => expect(within(menu).getByRole('group', { name: 'language' }))
        .toHaveAttribute('aria-busy', 'true'));

      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Türkçe' }));

      await settle();
      expect(setLocale).toHaveBeenCalledTimes(1);
      expect(setLocale).toHaveBeenCalledWith('en');
    });

    it('stays on the page when the action itself rejects', async () => {
      // `setLocale` swallows its own DB errors, but a transport failure rejects here. An
      // unhandled rejection inside `startTransition` escalates to the nearest error
      // boundary — swapping a language switcher for an error screen. The revert is the only
      // feedback this control has, and it must still happen.
      vi.mocked(setLocale).mockRejectedValue(new Error('offline'));
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));

      // Wait on `aria-busy`, not on the selection: the transition ending is the event this
      // test is about, and the selection can already read `tr` before it.
      await waitFor(() => expect(within(menu).getByRole('group', { name: 'language' }))
        .toHaveAttribute('aria-busy', 'false'));
      expect(within(menu).getByRole('menuitemradio', { name: 'Türkçe' }))
        .toHaveAttribute('aria-checked', 'true');
      expect(setLocale).toHaveBeenCalledWith('en');
      expect(menu).toBeInTheDocument();
    });

    it('keeps the menu open when a language is picked', async () => {
      // `MenuRadioItem` defaults `closeOnClick` to `false` where `MenuItem` defaults it to
      // `true`; that default is half the reason radio items are the right primitive here. A
      // preference control that dismisses its own menu is wrong.
      renderMenu(<UserMenu />);
      const menu = await openMenu('preferences');
      fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'English' }));
      await waitFor(() => expect(setLocale).toHaveBeenCalled());
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });

  describe('theme', () => {
    it('offers all three choices and marks System as the selected one', async () => {
      // Bound to `theme`, NOT `resolvedTheme`. `resolvedTheme` collapses `system` into
      // light or dark, so with the app's real default ('system', per app/layout.tsx) it
      // would report Light here and the user could never see which of the three they are
      // actually on. Swapping the binding to `resolvedTheme` fails this assertion.
      renderMenu(<UserMenu />, { theme: 'system' });
      const menu = await openMenu('preferences');
      const group = within(menu).getByRole('group', { name: 'theme' });

      expect(within(group).getAllByRole('menuitemradio').map((i) => i.textContent))
        .toEqual(['themeLight', 'themeDark', 'themeSystem']);
      expect(within(group).getByRole('menuitemradio', { name: 'themeSystem' }))
        .toHaveAttribute('aria-checked', 'true');
      expect(within(group).getByRole('menuitemradio', { name: 'themeLight' }))
        .toHaveAttribute('aria-checked', 'false');
      expect(within(group).getByRole('menuitemradio', { name: 'themeDark' }))
        .toHaveAttribute('aria-checked', 'false');
    });

    it('shows the explicitly chosen theme rather than the one it resolves to', async () => {
      // The other half of the `theme` vs `resolvedTheme` distinction: an explicit choice
      // must also be reported as itself, so this pins Dark while `system` is unselected.
      renderMenu(<UserMenu />, { theme: 'dark' });
      const menu = await openMenu('preferences');
      const group = within(menu).getByRole('group', { name: 'theme' });
      expect(within(group).getByRole('menuitemradio', { name: 'themeDark' }))
        .toHaveAttribute('aria-checked', 'true');
      expect(within(group).getByRole('menuitemradio', { name: 'themeSystem' }))
        .toHaveAttribute('aria-checked', 'false');
    });

    it('lets the user return to System after choosing an explicit theme', async () => {
      // The defect this replaces: `theme-toggle.tsx` flipped between explicit 'light' and
      // 'dark', so one tap stranded the user off `system` — the value the app boots with —
      // forever. The document class is asserted too, so this fails if the radio group is
      // decorative and never reaches next-themes.
      renderMenu(<UserMenu />, { theme: 'system' });
      const menu = await openMenu('preferences');
      const group = within(menu).getByRole('group', { name: 'theme' });

      fireEvent.click(within(group).getByRole('menuitemradio', { name: 'themeDark' }));
      await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
      expect(within(group).getByRole('menuitemradio', { name: 'themeDark' }))
        .toHaveAttribute('aria-checked', 'true');

      fireEvent.click(within(group).getByRole('menuitemradio', { name: 'themeSystem' }));
      await waitFor(() => expect(within(group).getByRole('menuitemradio', { name: 'themeSystem' }))
        .toHaveAttribute('aria-checked', 'true'));
      expect(localStorage.getItem('theme')).toBe('system');
    });

    it('stays a controlled group even when next-themes has no theme to report', async () => {
      // Deliberately rendered with no ThemeProvider, which is the one way to observe
      // `theme === undefined` from a test: feeding `undefined` to a controlled
      // `MenuRadioGroup` silently flips it to uncontrolled, and nothing would be selected.
      // The `?? 'system'` fallback is what keeps it controlled on every frame; drop it and
      // no row here is checked.
      render(<UserMenu />);
      const menu = await openMenu('preferences');
      const group = within(menu).getByRole('group', { name: 'theme' });
      expect(within(group).getByRole('menuitemradio', { name: 'themeSystem' }))
        .toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('sign out', () => {
    function stubLocation() {
      const location = { href: 'https://oarly.test/' };
      Object.defineProperty(window, 'location', { configurable: true, value: location });
      return location;
    }

    it('shows a spinner and keeps the menu open for the round trip', async () => {
      // `useFormStatus` — and therefore `PendingButton` — cannot see this: the round trip
      // is an `authClient` call from an onClick, not a form action. And `closeOnClick`
      // must be false, or the popup unmounts on the click and the spinner is never seen.
      stubLocation();
      let release!: () => void;
      const hanging = new Promise<void>((resolve) => { release = resolve; });
      vi.mocked(authClient.signOut).mockReturnValue(hanging as never);

      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      const item = within(menu).getByRole('menuitem', { name: 'signOut' });
      fireEvent.click(item);

      await waitFor(() => expect(within(menu).getByRole('status')).toBeInTheDocument());
      expect(screen.getByRole('menu')).toBeInTheDocument();
      // Matched on a regex, not the exact key: the Spinner is `role="status"
      // aria-label="Loading"`, so while it is on screen the row's accessible name is
      // "Loading signOut". That is deliberate — it is the only announcement this control
      // makes — so the query has to tolerate it rather than the component drop it.
      expect(within(menu).getByRole('menuitem', { name: /signOut/ }))
        .toHaveAttribute('data-disabled');

      await act(async () => { release(); await hanging; });
    });

    it('navigates to the sign-out target on success', async () => {
      const location = stubLocation();
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'signOut' }));

      await waitFor(() => expect(location.href).toBe(SESSION.signOutUrl));
      expect(authClient.signOut).toHaveBeenCalledTimes(1);
    });

    it('stays pending through the navigation', async () => {
      // Clearing `pending` on success would flash the row back to idle while the browser is
      // already unloading the page.
      const location = stubLocation();
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'signOut' }));

      await waitFor(() => expect(location.href).toBe(SESSION.signOutUrl));
      expect(within(menu).getByRole('status')).toBeInTheDocument();
    });

    it('returns to idle when signing out fails, so the user can retry', async () => {
      stubLocation();
      vi.mocked(authClient.signOut).mockRejectedValue(new Error('offline'));
      renderMenu(<UserMenu session={SESSION} />);
      const menu = await openMenu(SESSION.name);
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'signOut' }));

      await waitFor(() => expect(within(menu).queryByRole('status')).not.toBeInTheDocument());
      expect(within(menu).getByRole('menuitem', { name: 'signOut' }))
        .not.toHaveAttribute('data-disabled');
      expect(window.location.href).toBe('https://oarly.test/');
    });
  });
});
