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
