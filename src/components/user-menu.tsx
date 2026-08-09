'use client';
import { SlidersHorizontal } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  type ReactElement,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

import { authClient } from '@/auth-client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { asLocale, type Locale, locales } from '@/i18n/config';
import { setLocale } from '@/i18n/set-locale';
import { initials } from '@/lib/initials';

/**
 * Autonyms — each language named in itself — because a user who cannot read the current
 * UI language still has to be able to find their own. They are identical in both
 * catalogues, so they are a constant here rather than a pair of message keys; only the
 * group's label is prose and therefore translated.
 *
 * Only the full name is rendered now. `language-toggle.tsx` also carried a `short`
 * abbreviation (`TR` / `EN`) plus an `sr-only` autonym span, because its visible label
 * was the abbreviation while its accessible name had to contain the autonym. A menu row
 * has space for the autonym itself, so the visible label IS `Türkçe` / `English` and
 * WCAG 2.5.3 ("Label in Name") holds by construction. Do not reintroduce a hidden span:
 * it would duplicate the visible text inside the accessible name for no benefit.
 */
const LANGUAGE_NAMES: Record<Locale, string> = {
  tr: 'Türkçe',
  en: 'English',
};

const THEMES = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof THEMES)[number];

const THEME_LABEL_KEYS: Record<ThemeChoice, 'themeLight' | 'themeDark' | 'themeSystem'> = {
  light: 'themeLight',
  dark: 'themeDark',
  system: 'themeSystem',
};

/**
 * Client-mount flag without setState-in-effect: getServerSnapshot returns false
 * (server + initial hydration), getSnapshot returns true (post-hydration client).
 */
const emptySubscribe = () => () => {};

export type UserMenuSession = {
  name: string;
  email: string;
  image?: string | null;
  /** '/account' on the apex host; apexUrl('/account', origin) on a club subdomain. */
  accountUrl: string;
  signOutUrl: string;
};

/**
 * The whole page chrome — language, theme, account, sign out — behind one avatar.
 *
 * `session` is one optional object rather than a union of loose props, so "signed out but
 * somehow has an accountUrl" is unrepresentable: absent means guest. Language and theme
 * render for everyone; the identity header, Account and Sign out render only when
 * `session` is present.
 *
 * Both triggers are exactly `size-8` — `Button size="icon"` and `Avatar`'s default both
 * resolve to it. `app/s/[slug]/page.tsx` renders for guests and for members on the same
 * route, so a trigger whose width depended on auth state would shift that page's header
 * between the two renders: the same defect this component exists to remove, smaller.
 */
export function UserMenu({ session }: { session?: UserMenuSession | null }): ReactElement {
  const t = useTranslations('common');

  // -- Language ------------------------------------------------------------------------
  const activeLocale = useLocale() as Locale;
  const [localePending, startLocaleTransition] = useTransition();
  const [shownLocale, setShownLocale] = useOptimistic(activeLocale);

  // -- Theme ---------------------------------------------------------------------------
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  // -- Sign out ------------------------------------------------------------------------
  // Not a <form action>, so `useFormStatus` — and therefore `PendingButton` — cannot see
  // this: the round trip is an `authClient` call from an onClick. Hence local state.
  const [signingOut, setSigningOut] = useState(false);

  return (
    <DropdownMenu>
      {session ? (
        <DropdownMenuTrigger
          // The Avatar root is a <span>, not a <button>, so Base UI has to supply
          // role="button" + tabIndex itself; `nativeButton={false}` is what asks for that.
          nativeButton={false}
          // The accessible name is the person's name, not their initials: "İC" identifies
          // nobody when read aloud, and the image (when there is one) carries alt="" so it
          // contributes nothing.
          aria-label={session.name}
          render={
            <Avatar className="cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {session.image ? <AvatarImage src={session.image} alt="" /> : null}
              <AvatarFallback>{initials(session.name)}</AvatarFallback>
            </Avatar>
          }
        />
      ) : (
        <DropdownMenuTrigger
          aria-label={t('preferences')}
          render={
            <Button variant="ghost" size="icon">
              <SlidersHorizontal />
            </Button>
          }
        />
      )}

      {/*
        `w-56` is not decoration. The primitive's popup is `w-(--anchor-width)` — it sizes
        itself to the trigger — and the trigger here is 32px wide.
      */}
      <DropdownMenuContent
        align="end"
        // `aria-label` alone would lose: Base UI points the popup's `aria-labelledby` at
        // the trigger, and `aria-labelledby` outranks `aria-label`, so the menu would
        // announce as "İltan Caner" for a signed-in user. Clearing it hands the naming
        // back to the label. `mergeProps` follows the Object.assign pattern, so an
        // explicit `undefined` from here overwrites the internal value.
        aria-labelledby={undefined}
        aria-label={t('userMenu')}
        className="w-56"
      >
        {session ? (
          <>
            {/*
              The `DropdownMenuGroup` is required, not cosmetic: `MenuGroupLabel` throws
              "MenuGroupContext is missing" outside a `Menu.Group` / `Menu.RadioGroup`. It
              also reads correctly — the identity names the section that the Account link
              belongs to.
            */}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-foreground">
                <span className="block truncate text-sm font-medium">{session.name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {session.email}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {/*
                A plain <a>, not <Link>: on a club subdomain `accountUrl` is an absolute
                apex URL, and a client-side navigation cannot cross hosts.

                No `nativeButton={false}` — `MenuItem` already defaults it to `false`
                (item/MenuItem.js), unlike `MenuTrigger`, which defaults it to `true`.
                Passing it here changes nothing at all: the rendered element is
                byte-identical either way.
              */}
              <DropdownMenuItem render={<a href={session.accountUrl}>{t('account')}</a>} />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}

        {/*
          Radio items, not a nested ToggleGroup: Base UI's menu drives roving focus and
          typeahead over items registered with its composite list, so a `role="group"` of
          buttons dropped inside `role="menu"` content is both an invalid owned-element
          relationship and unreachable from the menu's arrow-key loop. Not a submenu
          either — two interactions for a two-item list, and a hover trap on touch.

          Staying open on select is free here: `MenuRadioItem` defaults `closeOnClick` to
          `false` (`MenuRadioItem.d.ts`), where `MenuItem` defaults it to `true`. A
          preference control that dismisses its own menu is wrong.

          The `DropdownMenuLabel` lives INSIDE the group on purpose: `MenuGroupLabel`
          registers its id with the enclosing group, which is what gives this radio group
          its accessible name.
        */}
        <DropdownMenuRadioGroup
          aria-busy={localePending}
          value={shownLocale}
          onValueChange={(value: unknown) => {
            // Base UI hands `onValueChange` an `any` (see MenuRadioGroup.d.ts) — the item's
            // `value` prop, verbatim. Narrow it rather than casting.
            const next = asLocale(String(value));
            // The `next === shown` clause is LOAD-BEARING here, unlike in the ToggleGroup
            // this was ported from. `MenuRadioItem`'s click handler calls
            // `setSelectedValue(value, details)` unconditionally — no `checked` guard
            // (radio-item/MenuRadioItem.js) — and `MenuRadioGroup.setValue` forwards
            // straight to `onValueChange` (radio-group/MenuRadioGroup.js). So re-selecting
            // the language that is already selected DOES re-fire with the same value, and
            // without this clause that is a real cookie write, a `localePerIp` rate-limit
            // token, a `user.locale` UPDATE and a `revalidatePath('/', 'layout')` — for a
            // no-op. It is reachable through this component's public surface and it is
            // covered by a test; keep both.
            if (!next || next === shownLocale || localePending) return;
            startLocaleTransition(async () => {
              setShownLocale(next);
              try {
                await setLocale(next);
              } catch {
                // The optimistic revert IS the feedback. `setLocale` swallows its own
                // database errors, but a transport failure — offline, an aborted POST, a
                // serialization error — rejects here, and an unhandled rejection inside
                // `startTransition` escalates to the nearest error boundary: a language
                // switcher would replace the page with an error screen. When the
                // transition ends, `useOptimistic` falls back to the server's locale, so a
                // failed switch simply snaps back, matching the action's silent refusal.
              }
            });
          }}
          className={localePending ? 'opacity-60 transition-opacity' : 'transition-opacity'}
        >
          <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
          {locales.map((locale) => (
            <DropdownMenuRadioItem key={locale} value={locale}>
              {LANGUAGE_NAMES[locale]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        {/*
          Bound to `theme`, NOT `resolvedTheme`. There are three choices and
          `resolvedTheme` collapses `system` into light or dark, so it cannot say which of
          the three is selected — and `theme-toggle.tsx` flipping between explicit 'light'
          and 'dark' meant a user who tapped once could never get back to `system`, which
          is what the app boots with (`app/layout.tsx`).

          The mount flag survives for a narrower reason than it had in `theme-toggle.tsx`:
          `theme` is `undefined` until next-themes has read storage, and feeding `undefined`
          to a controlled `MenuRadioGroup` flips it to uncontrolled and warns. Falling back
          to 'system' keeps it controlled on every frame. Its old anti-flash purpose is now
          satisfied by construction — the trigger renders nothing theme-dependent, and
          `MenuPortal.keepMounted` defaults to `false`, so the popup is not in the
          server-rendered tree at all.
        */}
        <DropdownMenuRadioGroup
          value={mounted ? (theme ?? 'system') : 'system'}
          onValueChange={(value: unknown) => setTheme(String(value))}
        >
          <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
          {THEMES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {t(THEME_LABEL_KEYS[choice])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {session ? (
          <>
            <DropdownMenuSeparator />
            {/*
              `closeOnClick={false}` is what keeps the spinner on screen for the round
              trip; `MenuItem` would otherwise unmount the popup on the click.
            */}
            <DropdownMenuItem
              variant="destructive"
              closeOnClick={false}
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                authClient
                  .signOut()
                  // Stays pending through the navigation: clearing it here would flash the
                  // row back to idle while the browser is already unloading the page.
                  .then(() => {
                    window.location.href = session.signOutUrl;
                  })
                  .catch(() => setSigningOut(false));
              }}
            >
              {signingOut ? <Spinner /> : null}
              {t('signOut')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
