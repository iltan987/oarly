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
        // no "no language" state — so `!next` is the real reclick path.
        //
        // `next === shown` is currently UNREACHABLE and is kept on purpose. Base UI's
        // single-select branch computes `newGroupValue = nextPressed ? [newValue] : []`
        // (node_modules/@base-ui/react/toggle-group/ToggleGroup.js:58), and the only item
        // that could report the already-shown value is the pressed one, whose
        // `nextPressed` is false — so it emits `[]`, not `[shown]`. The clause is an
        // upgrade guard: if Base UI ever re-emits the active value on reclick, every
        // reclick of the current language would become a real cookie write, a rate-limit
        // token, a `user.locale` UPDATE and a full-layout revalidate. Do not try to cover
        // it with a test and do not use it to demonstrate a mutation kill — it cannot be
        // reached through this component's public surface, and it has already produced
        // one false verification signal.
        if (!next || next === shown || pending) return;
        startTransition(async () => {
          setShown(next as Locale);
          try {
            await setLocale(next as Locale);
          } catch {
            // The optimistic revert IS the feedback. `setLocale` swallows its own
            // database errors, but a transport failure — offline, an aborted POST, a
            // serialization error — rejects here, and an unhandled rejection inside
            // `startTransition` escalates to the nearest error boundary: a language
            // switcher would replace the page with an error screen. When the transition
            // ends, `useOptimistic` falls back to the server's locale, so a failed
            // switch simply snaps back, matching the action's own silent refusal.
          }
        });
      }}
      className={pending ? 'opacity-60 transition-opacity' : 'transition-opacity'}
    >
      {locales.map((locale) => (
        <ToggleGroupItem key={locale} value={locale} className="text-xs font-medium">
          {/*
            No `aria-label` here. An `aria-label` REPLACES the accessible name rather
            than extending it, so the button would render as `TR` but be named `Türkçe` —
            a WCAG 2.5.3 "Label in Name" failure: a Voice Control / Voice Access / Dragon
            user reads `TR`, says "click TR", and nothing matches. (`EN` would have
            slipped through unnoticed, because "English" happens to contain "en".)
            Appending the autonym as visually hidden text keeps the visible label inside
            the accessible name — "TR Türkçe" — so speech input and the autonym both work.

            `px-2.5` is likewise absent: `spacing={0}` makes the primitive's
            `group-data-[spacing=0]/toggle-group:px-2` (specificity 0-3-0) beat any plain
            `px-*` (0-1-0), and tailwind-merge keeps both — so the class would assert a
            padding the element does not have.
          */}
          {LANGUAGES[locale].short}
          <span className="sr-only"> {LANGUAGES[locale].name}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
